/**
 * Pencarian Yahoo (id.search.yahoo.com) dengan cookie jar + retry 5x.
 *
 * Strategi anti-bot (hasil reverse-engineering):
 *   - Simpan cookie dari respons (set-cookie) di memori, kirim ulang header
 *     Cookie pada request berikutnya -> sesi tetap hangat & lolos challenge.
 *   - Warm-up homepage dulu buat seed cookie (best-effort, diabaikan kalau gagal).
 *   - Rotasi 3 host Yahoo (id/search/sg) karena satu host sering 429/503 di IP datacenter.
 *   - Retry hingga 5x dengan jeda eksponensial, karena Yahoo kadang mengejar
 *     rate-limit 503/429 sekali dua sebelum berhasil.
 *   - Deteksi halaman captcha/block (bukan hasil) -> retry host berikutnya.
 *   - Parsing hasil via cheerio (h3 a + fallback a /RU=) sehingga tidak
 *     bergantung pada satu struktur DOM yang rapuh.
 */
import { CookieJar } from 'tough-cookie';
import * as cheerio from 'cheerio';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const HOSTS = [
  'https://id.search.yahoo.com',
  'https://search.yahoo.com',
  'https://sg.search.yahoo.com',
];

const jar = new CookieJar();

function cookieHeader(origin) {
  try {
    return jar.getCookiesSync(origin).map((c) => `${c.key}=${c.value}`).join('; ') || null;
  } catch {
    return null;
  }
}

function absorbSetCookie(headers, origin) {
  const setCookies = headers?.getSetCookie?.() ?? [];
  for (const raw of setCookies) {
    try {
      jar.setCookieSync(raw, origin);
    } catch {
      /* abaikan cookie rusak */
    }
  }
}

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function buildHeaders(origin) {
  const ck = cookieHeader(origin);
  return {
    'user-agent': UA,
    'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'accept-language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
    'cache-control': 'max-age=0',
    'upgrade-insecure-requests': '1',
    'sec-fetch-site': 'same-origin',
    'sec-fetch-mode': 'navigate',
    'sec-fetch-user': '?1',
    'sec-fetch-dest': 'document',
    'sec-ch-ua': '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
    'referer': `${origin}/`,
    ...(ck ? { cookie: ck } : {}),
  };
}

// Halaman block/captcha Yahoo — bukan hasil valid, wajib retry.
function isBlockPage(html) {
  if (!html || html.length < 2000) return true;
  const low = html.slice(0, 20000).toLowerCase();
  return (
    low.includes('captcha') ||
    low.includes('not a robot') ||
    low.includes('robot check') ||
    low.includes('consent.yahoo.com') ||
    low.includes('guce.yahoo.com') ||
    (low.includes('yahoo') && !low.includes('<h3') && !low.includes('/ru='))
  );
}

function cleanTitle(rawTitle) {
  const t = (rawTitle || '').replace(/\s+/g, ' ').trim();
  if (!t) return '';
  if (t.includes('\u203A')) {
    return t.replace(/^.*\u203A\s*/, '').replace(/^(?:[a-z0-9]+(?:-[a-z0-9]+)*\s*)+/, '').trim() || t;
  }
  return t;
}

function unwrapYahooUrl(href) {
  if (!href) return null;
  let url = href;
  const ru = href.match(/\/RU=([^/]+)/);
  if (ru) {
    try {
      url = decodeURIComponent(ru[1]).split('/RK=')[0];
    } catch {
      /* pakai href apa adanya */
    }
  }
  // buang link internal yahoo
  if (/search\.yahoo\.com|guce\.yahoo\.com|consent\.yahoo\.com|r\.search\.yahoo/i.test(url)) return null;
  if (!/^https?:\/\//i.test(url)) return null;
  return url;
}

function parseResults(html) {
  const $ = cheerio.load(html);
  const results = [];
  const seen = new Set();

  const push = (title, href, li) => {
    const t = cleanTitle(title);
    if (!t || !href) return;
    const url = unwrapYahooUrl(href);
    if (!url || seen.has(url)) return;
    seen.add(url);
    let snippet = null;
    try {
      snippet = li?.find?.('p')?.first?.().text?.().replace(/\s+/g, ' ').trim() || null;
      if (!snippet) {
        snippet = li?.find?.('div[class*="compText"], span[class*="fc-falcon"]')?.first?.().text?.().replace(/\s+/g, ' ').trim() || null;
      }
    } catch {
      snippet = null;
    }
    results.push({ title: t, url, snippet });
  };

  // 1) pola utama: h3 > a
  $('h3 a[href]').each(function () {
    const a = $(this);
    push(a.closest('h3').text(), a.attr('href'), a.closest('li'));
  });

  // 2) fallback: semua link /RU= (layout Yahoo baru)
  if (results.length === 0) {
    $('a[href*="/RU="]').each(function () {
      const a = $(this);
      const txt = a.text().replace(/\s+/g, ' ').trim();
      if (!txt || txt.length < 5) return;
      // skip pagination / nav
      if (/^\d+$/.test(txt) || /next|prev|selanjutnya/i.test(txt)) return;
      push(txt, a.attr('href'), a.closest('li, div'));
    });
  }

  return results;
}

// Seed cookie dari homepage, best-effort (jangan bikin gagal kalau diblokir).
async function warmJar(host) {
  try {
    const res = await fetch(host + '/', {
      headers: buildHeaders(host),
      signal: AbortSignal.timeout(10000),
      redirect: 'follow',
    });
    absorbSetCookie(res.headers, host);
    await res.text().catch(() => '');
  } catch {
    /* abaikan */
  }
}

/**
 * Cari via Yahoo.
 * @param {string} query - kata kunci
 * @param {object} [opts]
 * @param {number} [opts.page=1] - nomor halaman (offset 1-based)
 * @param {number} [opts.limit=10] - ambil maks sejumlah ini hasil (1-20)
 * @param {function} [opts.onRetry] - callback ({attempt}) tiap percobaan
 * @returns {Promise<{source:string, query:string, page:number, limit:number, result_count:number, results:Array}>}
 */
export async function searchYahoo(query, opts = {}) {
  if (!query || typeof query !== 'string' || !query.trim()) {
    throw new Error("Parameter 'q' wajib diisi.");
  }
  const page = Math.max(parseInt(opts.page) || 1, 1);
  const limit = Math.min(Math.max(parseInt(opts.limit) || 10, 1), 20);

  let lastErr;
  for (let attempt = 1; attempt <= 5; attempt++) {
    const host = HOSTS[(attempt - 1) % HOSTS.length];
    try {
      opts.onRetry?.({ attempt, host });
      // warm-up cuma di attempt pertama biar gak lama
      if (attempt === 1 && !cookieHeader(host)) {
        await warmJar(host);
      }
      const params = new URLSearchParams({ p: query, b: (page - 1) * 10 + 1, ei: 'UTF-8' });
      const url = `${host}/search?${params.toString()}`;

      const res = await fetch(url, {
        headers: buildHeaders(host),
        signal: AbortSignal.timeout(15000),
        redirect: 'follow',
      });
      absorbSetCookie(res.headers, host);
      if (res.status === 429 || res.status === 503 || res.status === 500 || res.status === 403) {
        throw new Error(`Yahoo HTTP ${res.status} (${host})`);
      }
      if (!res.ok) throw new Error(`Yahoo HTTP ${res.status}`);

      const html = await res.text();
      if (isBlockPage(html)) {
        throw new Error(`Yahoo block/captcha page (${host})`);
      }
      const results = parseResults(html)
        .filter((r) => !/search\.yahoo\.com/.test(r.url))
        .slice(0, limit);
      if (results.length > 0) {
        return {
          source: 'search.yahoo.com',
          query: query.trim(),
          page,
          limit,
          result_count: results.length,
          results,
        };
      }
      throw new Error(`Yahoo kosong / layout berubah (${host})`);
    } catch (e) {
      lastErr = e;
      if (attempt < 5) await delay(500 * Math.pow(2, attempt - 1));
    }
  }
  throw lastErr || new Error('Gagal mencari di Yahoo');
}

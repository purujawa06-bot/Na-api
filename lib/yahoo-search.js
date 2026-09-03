/**
 * Pencarian Yahoo (id.search.yahoo.com) dengan cookie jar + retry 5x.
 *
 * Strategi anti-bot (hasil reverse-engineering):
 *   - Simpan cookie dari respons (set-cookie) di memori, kirim ulang header
 *     Cookie pada request berikutnya -> sesi tetap hangat & lolos challenge.
 *   - Retry hingga 5x dengan jeda eksponensial, karena Yahoo kadang mengejar
 *     rate-limit 503/429 sekali dua sebelum berhasil.
 *   - Parsing hasil via regex pada HTML (hanya butuh <a ... href> + teks)
 *     sehingga tidak bergantung pada struktur DOM yang rapuh.
 */
import { CookieJar } from 'tough-cookie';
import * as cheerio from 'cheerio';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const ORIGIN = 'https://id.search.yahoo.com';

const jar = new CookieJar();

function cookieHeader() {
  return jar.getCookiesSync(ORIGIN).map((c) => `${c.key}=${c.value}`).join('; ') || null;
}

function absorbSetCookie(headers) {
  const setCookies = headers?.getSetCookie?.() ?? [];
  for (const raw of setCookies) {
    try {
      jar.setCookieSync(raw, ORIGIN);
    } catch {
      /* abaikan cookie rusak */
    }
  }
}

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function parseResults(html) {
  const $ = cheerio.load(html);
  const results = [];
  const seen = new Set();

  $('h3 a[href]').each(function () {
    const a = $(this);
    const href = a.attr('href') || '';
    const li = a.closest('li');
    if (!href) return;

    const rawTitle = a.closest('h3').text().replace(/\s+/g, ' ').trim();
    if (!rawTitle) return;
    const title = rawTitle.includes('\u203A')
      ? rawTitle.replace(/^.*\u203A\s*/, '').replace(/^(?:[a-z0-9]+(?:-[a-z0-9]+)*\s*)+/, '').trim()
      : rawTitle;

    let url = href;
    const ru = href.match(/\/RU=([^/]+)/);
    if (ru) {
      try {
        url = decodeURIComponent(ru[1]).split('/RK=')[0];
      } catch {
        /* pakai href apa adanya */
      }
    }
    if (seen.has(url)) return;
    seen.add(url);

    const snippet = li.find('p').first().text().replace(/\s+/g, ' ').trim() || null;
    results.push({ title, url, snippet });
  });

  return results;
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

  const params = new URLSearchParams({ p: query, b: (page - 1) * 10 + 1, ei: 'UTF-8' });
  const url = `https://id.search.yahoo.com/search?${params.toString()}`;

  let lastErr;
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      opts.onRetry?.({ attempt });
      const res = await fetch(url, {
        headers: {
          'user-agent': UA,
          'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'accept-language': 'id-ID,id;q=0.9,en-US;q=0.8',
          ...(cookieHeader() ? { cookie: cookieHeader() } : {}),
        },
        signal: AbortSignal.timeout(15000),
        redirect: 'follow',
      });
      absorbSetCookie(res.headers);
      if (!res.ok) throw new Error(`Yahoo HTTP ${res.status}`);

      const html = await res.text();
      const results = parseResults(html)
        .filter((r) => !/search\.yahoo\.com/.test(r.url))
        .slice(0, limit);
      return {
        source: 'search.yahoo.com',
        query: query.trim(),
        page,
        limit,
        result_count: results.length,
        results,
      };
    } catch (e) {
      lastErr = e;
      if (attempt < 5) await delay(500 * Math.pow(2, attempt - 1));
    }
  }
  throw lastErr || new Error('Gagal mencari di Yahoo');
}

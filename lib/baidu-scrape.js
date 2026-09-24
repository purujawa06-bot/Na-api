/**
 * Web search MURNI scraping Baidu (tanpa API key).
 *
 * Bypass guard Baidu (Baidu menuntut cookie sesi BAIDUID dkk;
 * tanpa itu hasil kosong / halaman verifikasi):
 *   1. Cookie sesi dipanen dari homepage + disimpan PERSISTEN di
 *      Firebase RTDB (lib/cookie-store.js) -> dipakai ulang lintas
 *      restart/proses, meminimalkan pola request bot;
 *   2. Search dengan cookie + referer + UA browser yang dirotasi;
 *   3. Respons invalid (guard) -> refresh cookie -> simpan Firebase ->
 *      retry 1x dengan jeda sopan. Tetap invalid -> blocked.
 *
 * Parsing TAHAN hashed-class (class Baidu di-hash dan berubah tiap
 * deploy, mis. title-box_6uu5k): hanya mengandalkan jangkar stabil:
 *   - blok hasil: `result c-container`
 *   - URL asli: atribut `mu="https://..."` (tanpa perlu buka
 *     redirect /link?url= yang terenkripsi)
 *   - judul: `<!--s-text-->...<!--/s-text-->` lalu fallback isi <h3>
 *   - snippet: node teks terpanjang dalam blok (selain judul)
 * Blok iklan (penanda ec_/tuiguang) dibuang.
 */

import {
  safeKey,
  loadCookies,
  persistCookies,
  harvestCookies,
  cookieHeader,
} from './cookie-store.js';

/** Rotasi UA desktop agar sidik request tidak monoton (anti-throttle). */
const UAS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0',
];

const HOST = 'www.baidu.com';
const COOKIE_PATH = 'baidu_cookies';

/** Timeout tiap request HTTP (ms). */
const REQUEST_TIMEOUT_MS = 10000;

/** HTML search valid minimal (halaman verifikasi/captcha = tipis/tanpa hasil). */
const MIN_HTML_LEN = 50000;

/** TTL cache memori (ms): 30 menit + cap 300 entri. */
const CACHE_TTL_MS = 30 * 60 * 1000;
const CACHE_MAX_ENTRIES = 300;

/** Cache memori: key `${query}:${limit}` -> { at, data }. */
const cache = new Map();

function pickUA() {
  return UAS[Math.floor(Math.random() * UAS.length)];
}

function baseHeaders(ua, extra = {}) {
  return {
    'user-agent': ua,
    accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'accept-language': 'zh-CN,zh;q=0.9,id;q=0.8,en;q=0.7',
    'upgrade-insecure-requests': '1',
    ...extra,
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Hapus tag HTML + decode entity umum -> teks polos. */
function cleanText(s) {
  return String(s || '')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&[^;]+;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Normalisasi URL untuk dedupe. */
function normalizeUrl(u) {
  try {
    const p = new URL(u);
    const host = p.hostname.toLowerCase().replace(/^www\./, '');
    let path = p.pathname.replace(/\/+$/, '');
    if (path === '') path = '/';
    return `${host}${path}`.toLowerCase();
  } catch {
    return String(u).trim().toLowerCase().replace(/\/+$/, '');
  }
}

/**
 * Parse blok hasil organik dari HTML Baidu.
 * Kembalikan [{ title, url, snippet, source }].
 */
function parseResults(html) {
  const out = [];
  const blocks = html.split('result c-container').slice(1);
  for (const b of blocks) {
    const raw = b.slice(0, 60000);

    // Buang blok iklan (penanda promo Baidu).
    if (/tpl="ec|class="[^"]*\bec[\-_]|data-tuiguang| advertising/i.test(raw.slice(0, 2000))) continue;

    // URL asli SELALU di tag pembuka blok -> ekstrak SEBELUM strip tag.
    const mu = raw.match(/\smu="(https?:\/\/[^"]{5,500})"/);
    if (!mu) continue;
    const url = mu[1].replace(/&amp;/g, '&');
    if (!/^https?:\/\//i.test(url)) continue;
    try {
      if (/(^|\.)baidu\.com$/i.test(new URL(url).hostname)) continue; // link internal
    } catch {
      continue;
    }

    // Sisa tag pembuka dibuang agar atribut tak bocor jadi snippet.
    const seg = raw.replace(/^[^>]*>/, '');

    // Judul: s-text dulu (paling presisi), lalu seluruh isi <h3>.
    let title = '';
    const st = seg.match(/<!--s-text-->([\s\S]{1,400}?)<!--\/s-text-->/);
    if (st) title = cleanText(st[1]);
    if (!title) {
      const h3 = seg.match(/<h3[^>]*>([\s\S]*?)<\/h3>/);
      if (h3) title = cleanText(h3[1]).slice(0, 200);
    }
    if (!title || /^\s*广告\s*$/.test(title)) continue;
    // Buang slot union sampah: judulnya cuma nama domain.
    if (/^[\w-]+(\.[\w-]+)+\/?$/.test(title) && title.length < 40) continue;

    // Snippet: node teks terpanjang dalam blok selain judul.
    let snippet = null;
    const nodes = seg
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<[^>]+>/g, '|')
      .split('|')
      .map((s) => cleanText(s))
      .filter((s) => s.length >= 40 && s !== title && !title.includes(s) && !s.includes(title));
    if (nodes.length) {
      nodes.sort((a, b) => b.length - a.length);
      snippet = nodes[0].slice(0, 300);
    }

    const show = seg.match(/c-showurl[^>]*>([\s\S]{1,200}?)<\//);
    out.push({ title, url, snippet, source: show ? cleanText(show[1]).slice(0, 80) : null });
  }
  return out;
}

/** Cek validitas HTML search (guard = halaman verifikasi/tipis/tanpa blok hasil). */
function isValidSearchHtml(html) {
  return (
    typeof html === 'string' &&
    html.length >= MIN_HTML_LEN &&
    html.includes('result c-container') &&
    !/verify\.baidu\.com|wappass\.baidu|captcha|anti-?spider/i.test(html.slice(0, 5000))
  );
}

/** Satu GET halaman search dengan jar tertentu; kembalikan HTML valid atau null. */
async function trySearch(query, jar, ua) {
  const url = `https://${HOST}/s?wd=${encodeURIComponent(query)}&rn=20&ie=utf-8`;
  try {
    const res = await fetch(url, {
      headers: baseHeaders(ua, {
        cookie: cookieHeader(jar),
        referer: `https://${HOST}/`,
        'sec-fetch-dest': 'document',
        'sec-fetch-mode': 'navigate',
        'sec-fetch-site': 'same-origin',
      }),
      redirect: 'follow',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    harvestCookies(res, jar);
    if (!res.ok) return null;
    const html = await res.text();
    return isValidSearchHtml(html) ? html : null;
  } catch {
    return null;
  }
}

/**
 * Ambil halaman hasil Baidu: cookie tersimpan (Firebase) ->
 * invalid -> refresh via homepage -> retry 1x. Cookie baru HANYA
 * disimpan bila retry lolos (anti-racun store, pola sama Yahoo).
 */
async function fetchPage(query) {
  const key = safeKey(HOST);
  const ua = pickUA();
  let jar = await loadCookies(COOKIE_PATH, key);
  let html = await trySearch(query, jar, ua);
  if (html) {
    await persistCookies(COOKIE_PATH, key, jar);
    return { html, retried: false };
  }
  // Cookie invalid/basi -> panen baru dari homepage.
  const fresh = {};
  try {
    const res = await fetch(`https://${HOST}/`, {
      headers: baseHeaders(ua),
      redirect: 'manual',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    harvestCookies(res, fresh);
    await res.text().catch(() => {});
  } catch {
    /* abaikan */
  }
  await sleep(1500); // jeda sopan agar tak terlihat seperti bot
  html = await trySearch(query, fresh, pickUA());
  if (!html) return null;
  await persistCookies(COOKIE_PATH, key, fresh);
  return { html, retried: true };
}

function cacheGet(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return hit.data;
}

function cacheSet(key, data) {
  if (cache.size >= CACHE_MAX_ENTRIES) {
    cache.delete(cache.keys().next().value);
  }
  cache.set(key, { at: Date.now(), data });
}

/**
 * Cari web via scraping Baidu. Urutan hasil = ranking asli Baidu.
 * Gagal total (guard memblokir) -> { success:false, error:'baidu_blocked' }.
 */
export async function searchBaidu(query, { limit = 5 } = {}) {
  const q = String(query || '').trim();
  const n = Math.max(1, Math.min(Number(limit) || 5, 10));
  if (!q) {
    return { success: false, error: 'empty_query', query: q, count: 0, results: [] };
  }

  const key = `baidu:${q.toLowerCase()}:${n}`;
  const hit = cacheGet(key);
  if (hit) return { ...hit, cached: true };

  const page = await fetchPage(q);
  if (!page) {
    return {
      success: false,
      error: 'baidu_blocked',
      query: q,
      count: 0,
      results: [],
      source: 'baidu',
    };
  }

  const parsed = parseResults(page.html);
  const seen = new Set();
  const results = [];
  for (const r of parsed) {
    const k = normalizeUrl(r.url);
    if (seen.has(k)) continue;
    seen.add(k);
    results.push({
      title: r.title,
      url: r.url,
      snippet: r.snippet,
      source: r.source,
      engine: 'baidu',
      rank: results.length + 1,
    });
    if (results.length >= n) break;
  }
  if (!results.length) {
    return { success: false, error: 'no_results', query: q, count: 0, results: [], source: 'baidu' };
  }
  const data = {
    success: true,
    query: q,
    count: results.length,
    results,
    source: 'baidu',
    ...(page.retried ? { retried: true } : {}),
  };
  cacheSet(key, data);
  return { ...data, cached: false };
}

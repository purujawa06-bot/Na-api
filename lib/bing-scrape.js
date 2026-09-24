/**
 * Web search MURNI scraping Bing HTML (tanpa API key).
 *
 * Bypass guard (Bing ringan dibanding Yahoo: request polos tanpa
 * cookie pun lolos dari server, tapi cookie dipakai agar sesi
 * terlihat manusiawi dan tahan bila guard mengetat):
 *   1. Cookie sesi dipanen dari homepage + disimpan PERSISTEN di
 *      Firebase RTDB (lib/cookie-store.js) -> dipakai ulang lintas
 *      restart/proses;
 *   2. Search dengan cookie + referer + UA browser yang dirotasi;
 *   3. Respons invalid (guard) -> refresh cookie -> retry 1x dengan
 *      jeda sopan. Cookie baru HANYA disimpan bila retry TERBUKTI
 *      lolos (anti-racun store). Tetap invalid -> bing_blocked.
 *
 * Parsing jangkar stabil (class hashed diabaikan):
 *   - blok hasil organik: `<li class="b_algo"`
 *   - URL asli: redirect `/ck/a?...&u=a1<base64>&...` -> base64-decode
 *     (prefix 2 char `a1` dibuang); href langsung non-bing dipakai apa adanya
 *   - judul: isi `<h2>...</h2>` (boleh mengandung <strong>)
 *   - snippet: `<div class="b_caption"><p ...>...`
 * Link internal bing.com dibuang.
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

const HOST = 'www.bing.com';
const COOKIE_PATH = 'bing_cookies';

/** Timeout tiap request HTTP (ms). */
const REQUEST_TIMEOUT_MS = 10000;

/** HTML search valid minimal (halaman error/guard = tanpa blok hasil). */
const MIN_HTML_LEN = 40000;

/** TTL cache memori (ms): 30 menit + cap 300 entri. */
const CACHE_TTL_MS = 30 * 60 * 1000;
const CACHE_MAX_ENTRIES = 300;

/** Cache memori: key `${query}:${limit}:${lang}` -> { at, data }. */
const cache = new Map();

function pickUA() {
  return UAS[Math.floor(Math.random() * UAS.length)];
}

function baseHeaders(ua, lang, extra = {}) {
  return {
    'user-agent': ua,
    accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'accept-language':
      lang === 'en' ? 'en-US,en;q=0.9' : 'id-ID,id;q=0.9,en;q=0.8',
    'upgrade-insecure-requests': '1',
    ...extra,
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Kata generik yang diabaikan saat cek relevansi (id + en). */
const STOPWORDS = new Set(
  'yang,dan,di,ke,dari,untuk,dengan,adalah,apa,siapa,bagaimana,berapa,yaitu,atau,the,of,and,for,with,what,who,how,are,was,ini,itu,pada,oleh,agar'.split(
    ',',
  ),
);

/** Token signifikan query (huruf, panjang >= 4, bukan stopword). */
function queryTokens(query) {
  return (
    String(query || '')
      .toLowerCase()
      .match(/[a-z\u00c0-\u024f\u1e00-\u1eff]{4,}/g) || []
  ).filter((t) => !STOPWORDS.has(t));
}

/**
 * Cek relevansi: minimal SATU token query muncul di gabungan
 * judul+snippet+url 3 hasil pertama. Menolak mode degradasi Bing
 * (HTTP 200 + b_algo valid tapi isi generik: YouTube/Chrome/dll).
 * Tanpa token signifikan -> dianggap relevan (skip check).
 */
function looksRelevant(results, query) {
  const tokens = queryTokens(query);
  if (!tokens.length) return true;
  const hay = results
    .slice(0, 3)
    .map((r) => `${r.title} ${r.snippet || ''} ${r.url}`.toLowerCase())
    .join(' ');
  return tokens.some((t) => hay.includes(t));
}

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
 * Decode URL asli dari redirect Bing `/ck/a?...&u=a1<base64>&...`.
 * Kembalikan URL asli atau null bila bukan pola redirect yang dikenal.
 */
function decodeCkHref(href) {
  const m = String(href || '').match(/[?&]u=([A-Za-z0-9%+/_=-]+)/);
  if (!m) return null;
  let b64 = decodeURIComponent(m[1]);
  if (/^a1/i.test(b64)) b64 = b64.slice(2); // prefix 2 char Bing
  const pad = b64.length % 4;
  if (pad) b64 += '='.repeat(4 - pad);
  try {
    const url = Buffer.from(b64, 'base64').toString('utf8').replace(/\0/g, '');
    return /^https?:\/\/[^/]{3,200}/i.test(url) ? url : null;
  } catch {
    return null;
  }
}

/**
 * Parse blok hasil organik dari HTML Bing.
 * Kembalikan [{ title, url, snippet, source }].
 */
export function parseResults(html) {
  const out = [];
  const blocks = String(html || '').split('<li class="b_algo"').slice(1);
  for (const b of blocks) {
    const raw = b.slice(0, 60000).replace(/&amp;/g, '&');

    // href jangkar judul (di dalam <h2>).
    const h2 = raw.match(/<h2[^>]*>\s*<a[^>]*href="([^"]{5,2000})"[^>]*>([\s\S]{1,500}?)<\/a>\s*<\/h2>/);
    if (!h2) continue;
    let url = decodeCkHref(h2[1]);
    if (!url && /^https?:\/\//i.test(h2[1]) && !/bing\.com\//i.test(h2[1])) url = h2[1];
    if (!url) continue;
    let host = '';
    try {
      host = new URL(url).hostname.toLowerCase();
    } catch {
      continue;
    }
    if (/(^|\.)bing\.com$|(^|\.)microsoft\.com$/i.test(host)) continue; // link internal

    const title = cleanText(h2[2]).slice(0, 200);
    if (!title || title.length < 3) continue;

    // Snippet: paragraf caption di bawah judul.
    let snippet = null;
    const cap = raw.match(/<div class="b_caption"[^>]*>\s*<p[^>]*>([\s\S]{1,800}?)<\/p>/);
    if (cap) {
      const t = cleanText(cap[1].split('<a class="b_algoReadMore')[0]).slice(0, 300);
      if (t.length >= 20) snippet = t;
    }

    out.push({ title, url, snippet, source: host.replace(/^www\./, '') });
  }
  return out;
}

/** Cek validitas HTML search: struktur + relevansi isi terhadap query.
 *  Guard Bing = halaman tanpa blok hasil ATAU mode degradasi (hasil
 *  generik tak mengandung kata query walau HTTP 200). */
function isValidSearchHtml(html, query) {
  if (
    typeof html !== 'string' ||
    html.length < MIN_HTML_LEN ||
    !html.includes('<li class="b_algo"')
  ) {
    return false;
  }
  return looksRelevant(parseResults(html), query);
}

/** Satu GET halaman search dengan jar tertentu; kembalikan HTML valid atau null.
 *  URL POLOS (`?q=`) disengaja: parameter setlang/cc/count terbukti
 *  memicu 0 blok hasil / degradasi dari fetch server. */
async function trySearch(query, jar, ua, lang) {
  const url = `https://${HOST}/search?q=${encodeURIComponent(query)}`;
  try {
    const res = await fetch(url, {
      headers: baseHeaders(ua, lang, {
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
    return isValidSearchHtml(html, query) ? html : null;
  } catch {
    return null;
  }
}

/**
 * Ambil halaman hasil Bing: cookie tersimpan (Firebase) ->
 * invalid -> refresh via homepage -> retry 1x. Cookie baru HANYA
 * disimpan bila TERBUKTI lolos (anti-racun store).
 */
async function fetchPage(query, lang) {
  const key = safeKey(HOST);
  const ua = pickUA();
  let jar = await loadCookies(COOKIE_PATH, key);
  let html = await trySearch(query, jar, ua, lang);
  if (html) {
    await persistCookies(COOKIE_PATH, key, jar);
    return { html, retried: false };
  }
  // Cookie invalid/basi -> panen baru dari homepage.
  const fresh = {};
  try {
    const res = await fetch(`https://${HOST}/`, {
      headers: baseHeaders(ua, lang),
      redirect: 'manual',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    harvestCookies(res, fresh);
    await res.text().catch(() => {});
  } catch {
    /* abaikan */
  }
  await sleep(1500); // jeda sopan agar tak terlihat seperti bot
  html = await trySearch(query, fresh, pickUA(), lang);
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
 * Cari web via scraping Bing HTML. Urutan hasil = ranking asli Bing.
 * Gagal total (guard memblokir) -> { success:false, error:'bing_blocked' }.
 */
export async function searchBing(query, { limit = 5, lang = 'id' } = {}) {
  const q = String(query || '').trim();
  const n = Math.max(1, Math.min(Number(limit) || 5, 10));
  const lg = lang === 'en' ? 'en' : 'id';
  if (!q) {
    return { success: false, error: 'empty_query', query: q, count: 0, results: [] };
  }

  const key = `bing:${q.toLowerCase()}:${n}:${lg}`;
  const hit = cacheGet(key);
  if (hit) return { ...hit, cached: true };

  const page = await fetchPage(q, lg);
  if (!page) {
    return {
      success: false,
      error: 'bing_blocked',
      query: q,
      count: 0,
      results: [],
      source: 'bing',
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
      engine: 'bing',
      rank: results.length + 1,
    });
    if (results.length >= n) break;
  }
  if (!results.length) {
    return { success: false, error: 'no_results', query: q, count: 0, results: [], source: 'bing' };
  }
  const data = {
    success: true,
    query: q,
    count: results.length,
    results,
    source: 'bing',
    ...(page.retried ? { retried: true } : {}),
  };
  cacheSet(key, data);
  return { ...data, cached: false };
}

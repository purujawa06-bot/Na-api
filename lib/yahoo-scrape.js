/**
 * Web search MURNI scraping Yahoo (tanpa SearXNG, tanpa Wikipedia).
 *
 * Bypass guard Yahoo (request polos tanpa cookie -> HTTP 500 kosong):
 *   1. Cookie sesi (A1/A3/dll) disimpan PERSISTEN di Firebase RTDB
 *      (URL hardcode) + cache memori 10 menit, sehingga sesi dipakai
 *      ulang lintas restart/proses;
 *   2. Tiap search: pakai cookie tersimpan -> bila respons invalid
 *      (guard: HTTP error / halaman tipis) -> GET halaman depan untuk
 *      cookie baru -> simpan Firebase -> retry search 1x;
  *   3. Header UA browser yang dirotasi + referer (sidik tak monoton).
 *
 * Struktur hasil organik (layout "atomic"):
 *   <div class="dd [fst|lst] algo ..."> ...
 *     <a href="https://r.search.yahoo.com/.../RU=<url-encoded>/RK=2/...">
 *       ... <h3 class="title ..."><span>JUDUL</span></h3></a>
 *     <div class="compText ..."><p>SNIPPET</p></div>
 * Link outbound Yahoo selalu dibungkus r.search.yahoo.com + /RU=...,
 * jadi URL asli didapat via decodeURIComponent (tanpa request tambahan).
 *
 * Domain: lang=id -> id.search.yahoo.com (konten Indonesia),
 * selain itu -> search.yahoo.com.
 * Ranking = urutan asli Yahoo (sudah ter-ranking), diambil N teratas.
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

/** Timeout tiap request HTTP (ms). */
const REQUEST_TIMEOUT_MS = 8000;

const COOKIE_PATH = 'yahoo_cookies';

/** HTML search valid minimal (guard/bot-check = halaman tipis/kosong). */
const MIN_HTML_LEN = 20000;

/** TTL cache memori (ms): 30 menit + cap 300 entri. */
const CACHE_TTL_MS = 30 * 60 * 1000;
const CACHE_MAX_ENTRIES = 300;

/** Cache memori: key `${lang}:${query}:${limit}` -> { at, data }. */
const cache = new Map();

function domainFor(lang) {
  return lang === 'id' ? 'id.search.yahoo.com' : 'search.yahoo.com';
}

function pickUA() {
  return UAS[Math.floor(Math.random() * UAS.length)];
}

function baseHeaders(ua, extra = {}) {
  return {
    'user-agent': ua,
    accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'accept-language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
    'upgrade-insecure-requests': '1',
    ...extra,
  };
}

/**
 * Refresh cookie: GET halaman depan Yahoo untuk memanen cookie sesi
 * baru (A1/A3/dll), lalu simpan ke Firebase. Kembalikan jar baru
 * (bisa kosong bila homepage gagal).
 */
async function refreshSession(host, ua, jar = {}) {
  try {
    const res = await fetch(`https://${host}/`, {
      headers: baseHeaders(ua),
      redirect: 'manual',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    harvestCookies(res, jar);
    await res.text().catch(() => {});
  } catch {
    /* abaikan */
  }
  await persistCookies(COOKIE_PATH, safeKey(host), jar);
  return jar;
}

/** Cek validitas HTML search (guard/bot-check = status error / halaman tipis). */
function isValidSearchHtml(html) {
  return (
    typeof html === 'string' &&
    html.length >= MIN_HTML_LEN &&
    /<div class="dd (?:fst |lst )?algo /.test(html)
  );
}

/** Hapus tag HTML + decode entity umum -> teks polos. */
function cleanText(s) {
  return String(s || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&ndash;|&#8211;/g, '-')
    .replace(/&mdash;|&#8212;/g, '-')
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
 * Parse blok hasil organik dari HTML Yahoo.
 * Kembalikan [{ title, url, snippet, source }].
 */
function parseResults(html) {
  const out = [];
  const blocks = html.split(/<div class="dd (?:fst |lst )?algo /).slice(1);
  for (const b of blocks) {
    // Batas blok: div.dd berikutnya (hindari nyebrang ke blok lain).
    const cut = b.search(/<div class="dd /);
    const seg = cut > 0 ? b.slice(0, cut) : b;

    const ru = seg.match(/https:\/\/r\.search\.yahoo\.com\/[^"'<>\s]*?\/RU=([^/"'<>\s&]+)/);
    if (!ru) continue;
    let url;
    try {
      url = decodeURIComponent(ru[1]);
    } catch {
      continue;
    }
    if (!/^https?:\/\//i.test(url)) continue;
    // Buang link internal Yahoo (navigasi/pencarian terkait ikut terbungkus /RU=).
    try {
      if (/\.yahoo\.com$/i.test(new URL(url).hostname)) continue;
    } catch {
      continue;
    }

    const h3 = seg.match(/<h3[^>]*>([\s\S]{0,600}?)<\/h3>/);
    const title = h3 ? cleanText(h3[1]) : '';
    if (!title) continue;
    // Buang header seksi "pencarian terkait" yang ikut ke-parse sebagai hasil.
    if (/^(pencarian terkait|related searches|people also|orang juga)/i.test(title)) continue;

    const sn = seg.match(/<div class="compText[^>]*>\s*<p[^>]*>([\s\S]{0,900}?)<\/p>/);
    const snippet = sn ? cleanText(sn[1]) : null;

    const site = seg.match(/<span class="fc-141414 d-b">([^<]{1,80})<\/span>/);
    out.push({
      title,
      url,
      snippet,
      source: site ? cleanText(site[1]) : null,
    });
  }
  return out;
}

/** Satu GET halaman search dengan jar tertentu; kembalikan HTML valid atau null. */
async function trySearch(host, query, jar, ua) {
  const url =
    `https://${host}/search?p=${encodeURIComponent(query)}` + `&n=20&ei=UTF-8&nojs=1`;
  try {
    const res = await fetch(url, {
      headers: baseHeaders(ua, {
        cookie: cookieHeader(jar),
        referer: `https://${host}/`,
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
 * Ambil halaman hasil Yahoo: pakai cookie tersimpan (Firebase) ->
 * bila invalid (guard) -> refresh cookie via homepage -> simpan
 * Firebase -> retry 1x. Tetap invalid -> null (guard memblokir).
 */
async function fetchPage(host, query) {
  const key = safeKey(host);
  let jar = await loadCookies(COOKIE_PATH, key);
  let html = await trySearch(host, query, jar, pickUA());
  if (html) {
    await persistCookies(COOKIE_PATH, key, jar); // putar cookie segar balik ke Firebase
    return { html, retried: false };
  }
  jar = await refreshSession(host, pickUA(), {});
  await new Promise((r) => setTimeout(r, 1500)); // jeda sopan agar tak terlihat seperti bot
  html = await trySearch(host, query, jar, pickUA());
  if (!html) return null;
  await persistCookies(COOKIE_PATH, key, jar);
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
 * Cari web via scraping Yahoo. Urutan hasil = ranking asli Yahoo.
 * Gagal total (guard memblokir) -> { success:false, error:'yahoo_blocked' }.
 */
export async function searchYahoo(query, { limit = 5, lang = 'id' } = {}) {
  const q = String(query || '').trim();
  const n = Math.max(1, Math.min(Number(limit) || 5, 10));
  const lg = lang === 'en' ? 'en' : 'id';
  if (!q) {
    return { success: false, error: 'empty_query', query: q, count: 0, results: [] };
  }

  const key = `${lg}:${q.toLowerCase()}:${n}`;
  const hit = cacheGet(key);
  if (hit) return { ...hit, cached: true };

  const host = domainFor(lg);
  const page = await fetchPage(host, q);
  if (!page) {
    return {
      success: false,
      error: 'yahoo_blocked',
      query: q,
      count: 0,
      results: [],
      source: 'yahoo',
    };
  }
  return finalize(page.html, q, n, lg, key, page.retried);
}

function finalize(html, q, n, lg, key, retried) {
  const parsed = parseResults(html);
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
      engine: 'yahoo',
      rank: results.length + 1,
    });
    if (results.length >= n) break;
  }
  if (!results.length) {
    return {
      success: false,
      error: 'no_results',
      query: q,
      count: 0,
      results: [],
      source: 'yahoo',
    };
  }
  const data = {
    success: true,
    query: q,
    count: results.length,
    results,
    source: 'yahoo',
    lang: lg,
    ...(retried ? { retried: true } : {}),
  };
  cacheSet(key, data);
  return { ...data, cached: false };
}

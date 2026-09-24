/**
 * Provider Startpage untuk /api/search/web — scraping HTML hasil.
 *
 * Struktur hasil (terverifikasi via Brave/CDP, `temp/brave-startpage.html`):
 *   <div class="result css-..."> ...
 *     <a class="result-title result-link ..." href="URL_LANGSUNG" ...>
 *       <h2 class="wgl-title ...">JUDUL</h2></a>
 *     <p class="description css-...">SNIPPET</p>
 *   URL tampil langsung (tanpa redirect wrapper). Jangkar yang dipakai
 *   (`result-title result-link`, `description`, `gl-title-link`) adalah
 *   atribut semantik yang stabil; suffix `css-*` di-hash dan diabaikan.
 *
 * BATASAN JUJUR (hasil debugging CDP 09/2026): Startpage dilindungi
 * Anubis proof-of-work (difficulty 6 ≈ 16,7 jt hash SHA-256 ≈ 5 menit CPU
 * Node, melebihi maxDuration serverless) DAN cookie pasca-challenge
 * (`spchal-auth`) terikat fingerprint TLS koneksi yang menyelesaikan PoW
 * (cookie Brave yang valid TIDAK berlaku untuk fetch server meski IP sama).
 * Akibatnya dari server kemungkinan selalu: halaman challenge 22KB
 * (`anubis_challenge`) -> provider ini melaporkan `startpage_challenge`
 * TANPA menggagalkan provider lain. Provider bersifat OPORTUNISTIK:
 * aktif otomatis bila Startpage melonggarkan proteksi / dari IP bereputasi.
 *
 * Cookie sesi disimpan PERSISTEN di Firebase RTDB (lib/cookie-store.js)
 * mengikuti pola Yahoo/Baidu; refresh TIDAK PERNAH menimpa cookie bagus
 * dengan hasil gagal (pelajaran dari Yahoo: sesi bot menandai sesi).
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

const HOST = 'www.startpage.com';
const COOKIE_PATH = 'startpage_cookies';

/** Timeout tiap request HTTP (ms). */
const REQUEST_TIMEOUT_MS = 12000;

/** HTML hasil valid minimal (halaman challenge Anubis cuma ~22KB). */
const MIN_HTML_LEN = 50000;

/** TTL cache memori (ms): 30 menit + cap 300 entri (konsisten provider lain). */
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
    'accept-language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
    'upgrade-insecure-requests': '1',
    ...extra,
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Hapus tag HTML + decode entity umum -> teks polos. */
function cleanText(s) {
  return String(s || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/p>|<\/div>|<\/h2>|<\/li>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&rsaquo;|&lsaquo;/g, '›')
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

/** True bila HTML adalah halaman challenge Anubis (bukan hasil). */
export function isChallengeHtml(html) {
  return typeof html === 'string' && html.includes('anubis_challenge');
}

/**
 * Parse blok hasil organik Startpage.
 * Kembalikan [{ title, url, snippet, source }].
 */
export function parseResults(html) {
  const out = [];
  // `result ` (spasi) agar tak match `ss-gl-result`/`result-title`/`result-favicon`.
  const blocks = String(html).split(/<div class="result /).slice(1);
  for (const b of blocks) {
    // Batas blok: div.result berikutnya (hindari nyebrang blok).
    const cut = b.search(/<div class="result /);
    const seg = (cut > 0 ? b.slice(0, cut) : b).slice(0, 30000);
    if (!seg.includes('result-title result-link')) continue;

    const a = seg.match(
      /<a class="result-title result-link[^>]*?href="(https?:\/\/[^"]{5,800})"[^>]*?>[\s\S]{0,3000}?<h2[^>]*>([\s\S]{1,500}?)<\/h2>/,
    );
    if (!a) continue;
    const url = a[1].replace(/&amp;/g, '&');
    if (!/^https?:\/\//i.test(url)) continue;
    try {
      if (/(^|\.)startpage\.com$/i.test(new URL(url).hostname)) continue; // link internal
    } catch {
      continue;
    }
    const title = cleanText(a[2]).slice(0, 200);
    if (!title) continue;

    const sn = seg.match(/<p class="description[^>]*>([\s\S]{1,900}?)<\/p>/);
    const snippet = sn ? cleanText(sn[1]).slice(0, 300) || null : null;

    const site = seg.match(/wgl-site-title[^>]*>[\s\S]{0,500}?<span class="link-text[^>]*>([^<]{1,80})<\/span>/);
    out.push({
      title,
      url,
      snippet,
      source: site ? cleanText(site[1]).slice(0, 80) || null : null,
    });
  }
  return out;
}

/** Cek validitas HTML search (challenge Anubis / halaman tipis = invalid). */
function isValidSearchHtml(html) {
  return (
    typeof html === 'string' &&
    html.length >= MIN_HTML_LEN &&
    !isChallengeHtml(html) &&
    html.includes('<div class="result ')
  );
}

/** Satu GET halaman search dengan jar tertentu; kembalikan { html, challenged } atau null. */
async function trySearch(query, jar, ua) {
  const url = `https://${HOST}/sp/search?query=${encodeURIComponent(query)}`;
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
    if (isChallengeHtml(html)) return { html: null, challenged: true };
    return isValidSearchHtml(html) ? { html, challenged: false } : null;
  } catch {
    return null;
  }
}

/**
 * Ambil halaman hasil Startpage: cookie tersimpan (Firebase) ->
 * invalid -> refresh ringan via homepage -> simpan HANYA bila sukses ->
 * retry 1x. Challenge Anubis dari server tidak bisa di-bypass
 * (PoW TLS-bound) -> `startpage_challenge`.
 */
async function fetchPage(query) {
  const key = safeKey(HOST);
  let jar = await loadCookies(COOKIE_PATH, key);
  let r = await trySearch(query, jar, pickUA());
  if (r?.html) {
    await persistCookies(COOKIE_PATH, key, jar);
    return { html: r.html, challenged: false };
  }
  if (r?.challenged) return { html: null, challenged: true };
  // Refresh ringan: panen cookie homepage (challenge tak bisa di-solve server).
  const fresh = {};
  try {
    const res = await fetch(`https://${HOST}/`, {
      headers: baseHeaders(pickUA()),
      redirect: 'manual',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    harvestCookies(res, fresh);
    await res.text().catch(() => {});
  } catch {
    /* abaikan */
  }
  await sleep(1500);
  r = await trySearch(query, { ...jar, ...fresh }, pickUA());
  if (r?.html) {
    await persistCookies(COOKIE_PATH, key, { ...jar, ...fresh });
    return { html: r.html, challenged: false, retried: true };
  }
  return { html: null, challenged: !!r?.challenged, retried: true };
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
 * Cari web via Startpage. Provider OPORTUNISTIK (lihat batasan di atas):
 * sukses -> hasil ranking asli; challenge/gagal -> { success:false,
 * error:'startpage_challenge' | 'startpage_blocked' }.
 */
export async function searchStartpage(query, { limit = 5 } = {}) {
  const q = String(query || '').trim();
  const n = Math.max(1, Math.min(Number(limit) || 5, 10));
  if (!q) {
    return { success: false, error: 'empty_query', query: q, count: 0, results: [] };
  }

  const key = `startpage:${q.toLowerCase()}:${n}`;
  const hit = cacheGet(key);
  if (hit) return { ...hit, cached: true };

  const page = await fetchPage(q);
  if (!page.html) {
    return {
      success: false,
      error: page.challenged ? 'startpage_challenge' : 'startpage_blocked',
      query: q,
      count: 0,
      results: [],
      source: 'startpage',
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
      engine: 'startpage',
      rank: results.length + 1,
    });
    if (results.length >= n) break;
  }
  if (!results.length) {
    return { success: false, error: 'no_results', query: q, count: 0, results: [], source: 'startpage' };
  }
  const data = {
    success: true,
    query: q,
    count: results.length,
    results,
    source: 'startpage',
    ...(page.retried ? { retried: true } : {}),
  };
  cacheSet(key, data);
  return { ...data, cached: false };
}

/**
 * Web search via SearXNG Puru (instance tetap, tanpa API key).
 *
 *   GET https://searxng-puru.onrender.com/search?q=<query>&format=json&language=id|en
 *     -> { query, results: [{ title, url, content, engine | engines[] }], ... }
 *   (sesuai docs https://docs.searxng.org/dev/search_api.html)
 *
 * Mapping ke kontrak lama /api/search/web (konsisten, tak berubah bentuk):
 *   results[{ title, url, snippet (= content), source (= hostname), engine, rank }]
 * Gagal total (timeout / HTTP error / non-JSON) ->
 *   { success:false, error:'searxng_blocked' } (akhiran _blocked agar
 *   deteksi guard di route tetap jalan).
 * Kosong -> { success:false, error:'no_results' }.
 * Cache memori 30 menit + cap 300 entri.
 */

const SEARXNG_BASE_URL = 'https://searxng-puru.onrender.com';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/** Timeout tiap request HTTP (ms) — Render cold start bisa lambat. */
const REQUEST_TIMEOUT_MS = 20000;

/** TTL cache memori (ms): 30 menit + cap 300 entri. */
const CACHE_TTL_MS = 30 * 60 * 1000;
const CACHE_MAX_ENTRIES = 300;

/** Cache memori: key `${lang}:${query}:${limit}` -> { at, data }. */
const cache = new Map();

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

/** Bersihkan snippet (content SearXNG bisa mengandung entity/whitespace) -> teks polos. */
function cleanSnippet(s) {
  return String(s || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&[^;]+;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300);
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

/** Nama situs dari URL (tanpa www). */
function sourceFromUrl(u) {
  try {
    return new URL(u).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

/**
 * Cari web via SearXNG Puru (instance tetap).
 * @param {string} query - kata kunci
 * @param {object} [opts]
 * @param {number} [opts.limit=5] - jumlah hasil (1-20)
 * @param {string} [opts.lang='id'] - 'id' atau 'en' (diteruskan sebagai language)
 */
export async function searchSearxngPuru(query, { limit = 5, lang = 'id' } = {}) {
  const q = String(query || '').trim();
  const n = Math.max(1, Math.min(Number(limit) || 5, 20));
  const lg = lang === 'en' ? 'en' : 'id';
  if (!q) {
    return { success: false, error: 'empty_query', query: q, count: 0, results: [] };
  }

  const key = `searxng-puru:${lg}:${q.toLowerCase()}:${n}`;
  const hit = cacheGet(key);
  if (hit) return { ...hit, cached: true };

  const fail = (error) => ({
    success: false,
    error,
    query: q,
    count: 0,
    results: [],
    source: 'searxng',
  });

  const url =
    `${SEARXNG_BASE_URL}/search?q=${encodeURIComponent(q)}` +
    `&format=json&language=${lg}&categories=general&safesearch=1&pageno=1`;

  let body;
  try {
    const res = await fetch(url, {
      headers: { 'user-agent': UA, accept: 'application/json' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) return fail('searxng_blocked');
    try {
      body = await res.json();
    } catch {
      return fail('searxng_blocked');
    }
  } catch {
    return fail('searxng_blocked');
  }

  const raw = Array.isArray(body?.results) ? body.results : [];
  const seen = new Set();
  const results = [];
  for (const item of raw) {
    const title = typeof item?.title === 'string' ? item.title.trim().slice(0, 200) : '';
    const href = typeof item?.url === 'string' ? item.url.trim() : '';
    if (!title || title.length < 3 || !href || !/^https?:\/\//i.test(href)) continue;
    const k = normalizeUrl(href);
    if (seen.has(k)) continue;
    seen.add(k);
    const snippet =
      typeof item?.content === 'string' && item.content.trim()
        ? cleanSnippet(item.content)
        : null;
    const engine =
      typeof item?.engine === 'string'
        ? item.engine
        : Array.isArray(item?.engines) && item.engines[0]
          ? String(item.engines[0])
          : 'searxng';
    results.push({
      title,
      url: href,
      snippet,
      source: sourceFromUrl(href),
      engine,
      rank: results.length + 1,
    });
    if (results.length >= n) break;
  }

  if (!results.length) return fail('no_results');

  const data = {
    success: true,
    query: q,
    count: results.length,
    results,
    source: 'searxng',
    lang: lg,
  };
  cacheSet(key, data);
  return { ...data, cached: false };
}

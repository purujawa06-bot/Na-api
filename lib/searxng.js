/**
 * Web search via SearXNG (meta-search, tanpa API key).
 *
 * Sesuai docs https://docs.searxng.org/dev/search_api.html :
 *   GET {instance}/search?q=<query>&format=json&language=id
 *   -> { query, results: [{title, url, content, engine(s)}],
 *        suggestions, corrections, ... }
 * (catatan docs: banyak instance publik menonaktifkan format json —
 *  karena itu daftar diambil dinamis + di-probe, bukan hardcode mati.)
 *
 * Strategi:
 *   - Daftar instance DINAMIS dari monitor publik searx.space
 *     (filter https + success >= 80%), di-probe berkala untuk
 *     memastikan format=json hidup dari IP ini (working set, refresh
 *     6 jam). Tanpa URL hardcode; bila kosong -> fallback Wikipedia.
 *   - Tembak working set paralel via Promise.all (tiap request
 *     timeout 5 detik, gagal satu tidak menggagalkan yang lain).
 *   - Gabung hasil, verifikasi (URL http(s) + title wajib ada),
 *     buang duplikat (normalisasi URL), ranking: skor kecocokan kata
 *     query + bonus tiap instance tambahan yang memuat URL sama —
 *     yang paling relevan naik ke atas, lalu ambil 10 teratas.
 *   - Cache memori (Map) selama proses Vercel masih jalan (warm),
 *     TTL 30 menit + cap 300 entri agar tidak bocor.
 *   - Default bahasa Indonesia (language=id).
 *   - Lapisan pemulih (impor dari bing-search.js):
 *     1. Auto-koreksi typo huruf ganda 1x retry (flag `corrected_from`).
 *     2. Fallback Wikipedia bila semua instance gagal/kosong/tak relevan
 *        (flag `fallback: 'wikipedia'`).
 */

import {
  scoreResult,
  suggestCorrection,
  searchWikipediaFallback,
} from './bing-search.js';

/**
 * Daftar instance MURNI DINAMIS dari monitor publik searx.space —
 * tidak ada URL instance yang di-hardcode di file ini.
 * Bila searx.space tak bisa dihubungi sama sekali, working set kosong
 * dan alur otomatis lanjut ke fallback Wikipedia.
 */

/** Sumber daftar instance dinamis: monitor publik searx.space. */
const SEARX_SPACE_URL = 'https://searx.space/data/instances.json';

/** Maks kandidat yang di-probe per refresh + maks instance dipakai per search (10 req bersamaan). */
const MAX_PROBE_CANDIDATES = 15;
const MAX_INSTANCES_PER_SEARCH = 10;

/** TTL daftar kandidat (24 jam) & working set terprobe (6 jam). */
const LIST_TTL_MS = 24 * 60 * 60 * 1000;
const WORKING_TTL_MS = 6 * 60 * 60 * 1000;

/** Query ringan untuk probe (hemat, pasti ada hasilnya bila sehat). */
const PROBE_QUERY = 'wikipedia';

let listCache = { at: 0, urls: [] };
let workingCache = { at: 0, urls: [] };
let refreshPromise = null; // cegah stampede refresh bersamaan

/**
 * Ambil daftar kandidat instance DINAMIS dari searx.space
 * (filter: https + ada versi + search success >= 80%), cache 24 jam.
 * Gagal -> list kosong (alur lanjut ke fallback Wikipedia).
 */
async function getCandidates() {
  if (Date.now() - listCache.at < LIST_TTL_MS && listCache.urls.length) {
    return listCache.urls;
  }
  try {
    const res = await fetch(SEARX_SPACE_URL, {
      headers: { 'user-agent': UA, accept: 'application/json' },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new Error(`searx.space HTTP ${res.status}`);
    const body = await res.json();
    const urls = Object.entries(body?.instances || {})
      .filter(
        ([u, v]) =>
          typeof u === 'string' &&
          u.startsWith('https://') &&
          v?.version &&
          (v.timing?.search?.success_percentage ?? 0) >= 80
      )
      .sort((a, b) => b[1].timing.search.success_percentage - a[1].timing.search.success_percentage)
      .slice(0, MAX_PROBE_CANDIDATES)
      .map(([u]) => u);
    if (urls.length) listCache = { at: Date.now(), urls };
  } catch {
    /* abaikan -> working set kosong -> fallback Wikipedia */
  }
  return listCache.urls;
}

/**
 * Probe satu kandidat: wajib mengembalikan JSON valid ber-format SearXNG.
 * Dipakai untuk membangun working set, TIDAK pernah reject.
 */
async function probeInstance(base) {
  const r = await fetchInstance(base, PROBE_QUERY, 'id');
  return r && Array.isArray(r.results) ? base : null;
}

/**
 * Working set = kandidat yang TERBUKTI melayani format=json dari IP ini
 * (maks 10), di-refresh tiap 6 jam (atau saat hasil search kosong total).
 * Tanpa hardcode: murni hasil probe dinamis.
 */
async function getWorkingInstances(force = false) {
  if (!force && Date.now() - workingCache.at < WORKING_TTL_MS && workingCache.urls.length) {
    return workingCache.urls;
  }
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    try {
      const candidates = await getCandidates();
      const probed = (
        await Promise.all(candidates.map((base) => probeInstance(base)))
      ).filter(Boolean);
      const urls = [...new Set(probed)].slice(0, MAX_INSTANCES_PER_SEARCH);
      workingCache = { at: Date.now(), urls };
      return urls;
    } finally {
      refreshPromise = null;
    }
  })();
  return refreshPromise;
}

/** Timeout tiap request instance (ms), sesuai permintaan: 5 detik. */
const REQUEST_TIMEOUT_MS = 5000;

/** Jumlah URL teratas yang diambil dari hasil gabungan. */
const TOP_URLS = 10;

/** TTL cache memori (ms): 30 menit. */
const CACHE_TTL_MS = 30 * 60 * 1000;

/** Batas entri cache agar memori tidak bocor. */
const CACHE_MAX_ENTRIES = 300;

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/** Cache memori: key `${lang}:${query}` -> { at, data }. */
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
    // Buang entri terlama (Map menjaga urutan insert).
    const oldest = cache.keys().next().value;
    cache.delete(oldest);
  }
  cache.set(key, { at: Date.now(), data });
}

/** Normalisasi URL untuk dedupe antar instance. */
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
 * Satu request ke satu instance. TIDAK pernah reject — gagal (timeout,
 * HTTP error, format json dimatikan, dsb.) mengembalikan null agar
 * Promise.all tetap menghasilkan dari instance lain.
 */
async function fetchInstance(base, query, lang) {
  const url =
    `${base}search?q=${encodeURIComponent(query)}` +
    `&format=json&language=${lang}&categories=general&safesearch=1&pageno=1`;
  try {
    const res = await fetch(url, {
      headers: { 'user-agent': UA, accept: 'application/json' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const body = await res.json();
    if (!body || !Array.isArray(body.results)) return null;
    return {
      base,
      results: body.results,
      suggestions: Array.isArray(body.suggestions) ? body.suggestions : [],
      corrections: Array.isArray(body.corrections) ? body.corrections : [],
    };
  } catch {
    return null;
  }
}

/**
 * Verifikasi + gabung hasil semua instance: URL http(s) dan title wajib
 * ada; duplikat dibuang; ranking = skor kata + bonus kemunculan di
 * banyak instance. Kembalikan { merged, best, needed, suggestions }.
 */
function mergeResults(responses, query, limit) {
  const words = query.toLowerCase().split(/[^a-z0-9]+/i).filter((w) => w.length >= 3);
  const needed = words.length >= 2 ? 2 : 1;
  const merged = [];
  const seen = new Set();
  let suggestions = [];

  for (const r of responses) {
    if (!r) continue;
    if (!suggestions.length && r.suggestions.length) suggestions = r.suggestions;
    for (const item of r.results) {
      const url = typeof item?.url === 'string' ? item.url.trim() : '';
      const title = typeof item?.title === 'string' ? item.title.trim() : '';
      if (!url || !title || !/^https?:\/\//i.test(url)) continue;
      const key = normalizeUrl(url);
      const snippet =
        typeof item?.content === 'string' && item.content.trim()
          ? item.content.trim()
          : typeof item?.snippet === 'string'
            ? item.snippet
            : null;
      const engine =
        typeof item?.engine === 'string'
          ? item.engine
          : Array.isArray(item?.engines)
            ? item.engines[0] || null
            : null;
      const dup = merged.find((m) => m._key === key);
      if (dup) {
        dup._hits += 1; // URL sama di banyak instance = sinyal relevan
        if (!dup.engine && engine) dup.engine = engine;
        continue;
      }
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push({ _key: key, title, url, snippet, engine, _hits: 1 });
    }
  }

  merged.forEach((r, i) => {
    const all = `${r.title || ''} ${r.snippet || ''} ${r.url || ''}`.toLowerCase();
    r._c = words.filter((w) => all.includes(w)).length;
    r._s = scoreResult(r, words) + r._hits * 2;
    r._i = i;
  });
  merged.sort((a, b) => b._c - a._c || b._s - a._s || a._i - b._i);

  const results = merged.slice(0, limit).map(({ title, url, snippet }) => ({ title, url, snippet }));
  return { merged, best: merged.length ? merged[0]._c : 0, needed, results, suggestions };
}

/** Tembak working set paralel, gabung + ranking, ambil 10 teratas. */
async function doSearch(query, { limit, lang }) {
  // Daftar instance DINAMIS (searx.space + probe). Promise.all: semua
  // request jalan bersamaan; fetchInstance tak pernah reject sehingga
  // satu instance mati tak menggagalkan yang lain.
  let bases = await getWorkingInstances();
  let responses = await Promise.all(bases.map((base) => fetchInstance(base, query, lang)));
  // Nol total yang hidup -> working set basi, refresh paksa sekali.
  if (!responses.some(Boolean)) {
    bases = await getWorkingInstances(true);
    responses = await Promise.all(bases.map((base) => fetchInstance(base, query, lang)));
  }
  const live = responses.filter(Boolean).length;
  const out = mergeResults(responses, query, Math.min(limit, TOP_URLS));
  return {
    source: 'searxng',
    query: query.trim(),
    lang,
    limit,
    best: out.best,
    needed: out.needed,
    merged: out.merged,
    results: out.results,
    suggestions: out.suggestions,
    instances_used: live,
    instances_total: bases.length,
  };
}

/** Bentuk respons akhir + simpan cache. */
function finalize(searched, cacheKey) {
  const out = {
    source: searched.source,
    query: searched.query,
    lang: searched.lang,
    limit: searched.limit,
    result_count: searched.results.length,
    results: searched.results,
  };
  if (searched.corrected_from) out.corrected_from = searched.corrected_from;
  if (searched.fallback) out.fallback = searched.fallback;
  if (searched.suggestion) out.suggestion = searched.suggestion;
  if (searched.instances_used != null) {
    out.instances_used = searched.instances_used;
    out.instances_total = searched.instances_total;
  }
  cacheSet(cacheKey, out);
  return { ...out, cached: false };
}

/**
 * Cari web via SearXNG multi-instance.
 * @param {string} query - kata kunci
 * @param {object} [opts]
 * @param {number} [opts.limit=10] - jumlah hasil (1-20, maks 10 dari SearXNG lalu dilengkapi fallback bila perlu)
 * @param {string} [opts.lang='id'] - 'id' atau 'en' (default 'id')
 * @returns {Promise<{source:string, query:string, lang:string, limit:number, result_count:number, results:Array, cached:boolean, corrected_from?:string, fallback?:string}>}
 */
export async function searchSearxng(query, opts = {}) {
  if (!query || typeof query !== 'string' || !query.trim()) {
    throw new Error("Parameter 'query' wajib diisi.");
  }
  const limit = Math.min(Math.max(parseInt(opts.limit) || 10, 1), 20);
  const lang = opts.lang === 'en' ? 'en' : 'id';
  const original = query.trim();
  const cacheKey = `${lang}:${original.toLowerCase()}`;

  const hit = cacheGet(cacheKey);
  if (hit) return { ...hit, cached: true };

  const first = await doSearch(original, { limit, lang });
  if (first.best >= first.needed && first.results.length > 0) {
    return finalize(first, cacheKey);
  }
  if (opts._retried) return finalize(first, cacheKey);

  // Hasil nihil/tak relevan -> coba koreksi typo sekali.
  const corrected = suggestCorrection(original);
  if (corrected) {
    const second = await doSearch(corrected, { limit: first.limit, lang });
    if (second.best >= second.needed && second.results.length > 0 && second.best >= first.best) {
      second.query = corrected;
      second.corrected_from = original;
      return finalize(second, cacheKey);
    }
  }

  // Semua instance gagal/kosong/tak relevan -> fallback Wikipedia.
  const wikiQueries = [original];
  if (corrected && corrected !== original) wikiQueries.push(corrected);
  const wiki = await searchWikipediaFallback(wikiQueries, { limit, lang });
  if (wiki) {
    wiki.limit = limit;
    wiki.lang = lang;
    if (wiki.query !== original) wiki.corrected_from = original;
    wiki.instances_used = first.instances_used;
    wiki.instances_total = first.instances_total;
    cacheSet(cacheKey, wiki);
    return { ...wiki, cached: false };
  }

  const out = finalize(first, cacheKey);
  if (corrected && first.merged.length > 0) {
    out.suggestion = corrected;
    cacheSet(cacheKey, out);
  }
  return out;
}

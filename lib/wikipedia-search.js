/**
 * Provider Wikipedia untuk /api/search/web — via MediaWiki API resmi
 * (BUKAN scraping, tanpa cookie, tanpa guard, stabil dari server).
 *
 * Dua panggilan paralel per search:
 *   1. `action=opensearch` — title-match presisi (judul + URL kanonis,
 *      tanpa snippet bermakna);
 *   2. `action=query&list=search` — fulltext (snippet HTML + judul).
 * Hasil digabung (opensearch didahulukan = artikel paling tepat),
 * dedupe judul, dipotong `limit`.
 *
 * Host mengikuti `lang`: id -> id.wikipedia.org, en -> en.wikipedia.org.
 * Snippet fulltext mengandung tag HTML (<span class="searchmatch">)
 * yang dibersihkan + entity di-decode.
 * Ranking = urutan gabungan (sudah ter-ranking oleh MediaWiki).
 */

const UA = 'Na-api/1.0 (https://github.com/purujawa06-bot/Na-api; web-search)';

/** Timeout tiap request HTTP (ms). */
const REQUEST_TIMEOUT_MS = 10000;

/** TTL cache memori (ms): 30 menit + cap 300 entri (konsisten provider lain). */
const CACHE_TTL_MS = 30 * 60 * 1000;
const CACHE_MAX_ENTRIES = 300;

/** Cache memori: key `${lang}:${query}:${limit}` -> { at, data }. */
const cache = new Map();

function hostFor(lang) {
  return lang === 'en' ? 'en.wikipedia.org' : 'id.wikipedia.org';
}

/** Bersihkan snippet fulltext MediaWiki (tag + entity) -> teks polos. */
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

function articleUrl(host, title) {
  return `https://${host}/wiki/${encodeURIComponent(String(title).replace(/ /g, '_'))}`;
}

async function getJson(url) {
  const res = await fetch(url, {
    headers: { 'user-agent': UA, accept: 'application/json' },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) return null;
  try {
    return await res.json();
  } catch {
    return null;
  }
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
 * Cari artikel Wikipedia. Selalu mencoba (API publik, tanpa guard);
 * gagal total (jaringan) -> { success:false, error:'wikipedia_blocked' }.
 */
export async function searchWikipedia(query, { limit = 5, lang = 'id' } = {}) {
  const q = String(query || '').trim();
  const n = Math.max(1, Math.min(Number(limit) || 5, 10));
  const lg = lang === 'en' ? 'en' : 'id';
  if (!q) {
    return { success: false, error: 'empty_query', query: q, count: 0, results: [] };
  }

  const key = `wiki:${lg}:${q.toLowerCase()}:${n}`;
  const hit = cacheGet(key);
  if (hit) return { ...hit, cached: true };

  const host = hostFor(lg);
  const [open, full] = await Promise.all([
    getJson(
      `https://${host}/w/api.php?action=opensearch&search=${encodeURIComponent(q)}&limit=10&format=json`,
    ).catch(() => null),
    getJson(
      `https://${host}/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(q)}&format=json&srlimit=10`,
    ).catch(() => null),
  ]);

  if (!open && !full) {
    return {
      success: false,
      error: 'wikipedia_blocked',
      query: q,
      count: 0,
      results: [],
      source: 'wikipedia',
    };
  }

  // Gabung: opensearch (title-match) dulu, lalu fulltext.
  const merged = [];
  const seen = new Set();
  const push = (title, url, snippet) => {
    const t = String(title || '').trim();
    if (!t) return;
    // Buang halaman non-artikel (namespace bantu/navigasi).
    const low = t.toLowerCase();
    if (low === 'halaman utama' || low === 'main page' || t.includes(':')) return;
    const k = low;
    if (seen.has(k)) return;
    seen.add(k);
    merged.push({ title: t, url, snippet: snippet || null });
  };

  if (Array.isArray(open) && Array.isArray(open[1])) {
    open[1].forEach((t, i) => {
      const url = Array.isArray(open[3]) && open[3][i] ? open[3][i] : articleUrl(host, t);
      const sn = Array.isArray(open[2]) && open[2][i] ? cleanSnippet(open[2][i]) : null;
      push(t, url, sn || null);
    });
  }
  const hits = full?.query?.search || [];
  // Petakan snippet fulltext ke judul yang sudah ada (perkaya), sisanya tambah.
  const snipByTitle = new Map();
  for (const s of hits) {
    const sn = cleanSnippet(s.snippet);
    if (s.title && sn && !snipByTitle.has(String(s.title).toLowerCase())) {
      snipByTitle.set(String(s.title).toLowerCase(), sn);
    }
  }
  for (const m of merged) {
    if (!m.snippet) {
      const sn = snipByTitle.get(m.title.toLowerCase());
      if (sn) m.snippet = sn;
    }
  }
  for (const s of hits) {
    if (!s.title) continue;
    const k = String(s.title).toLowerCase();
    if (seen.has(k)) continue;
    push(`${s.title} — Wikipedia`, articleUrl(host, s.title), cleanSnippet(s.snippet));
  }

  const results = merged.slice(0, n).map((r, i) => ({
    title: r.title,
    url: r.url,
    snippet: r.snippet,
    source: host,
    engine: 'wikipedia',
    rank: i + 1,
  }));

  if (!results.length) {
    return {
      success: false,
      error: 'no_results',
      query: q,
      count: 0,
      results: [],
      source: 'wikipedia',
    };
  }
  const data = { success: true, query: q, count: results.length, results, source: 'wikipedia', lang: lg };
  cacheSet(key, data);
  return { ...data, cached: false };
}

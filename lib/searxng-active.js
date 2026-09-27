/**
 * Web search via pre-checked SearXNG instances.
 *
 * The instance list comes from a daily-checked registry file
 * (SearXNG-active-instance/active.json) that only contains instances
 * proven to serve `format=json` with HTTP 200. Every listed instance
 * is queried in parallel via `Promise.all`, results are merged,
 * de-duplicated by normalized URL, then ranked by relevance score
 * so the most relevant hits move to the top.
 *
 * No API key, no cookies, no scraping guards — plain SearXNG JSON API.
 */

const ACTIVE_JSON_URL =
  'https://raw.githubusercontent.com/purujawa06-bot/SearXNG-active-instance/refs/heads/main/active.json';

/** Registry list cache TTL (1 hour; upstream refreshes daily). */
const ACTIVE_TTL_MS = 60 * 60 * 1000;

/** Per-instance request timeout (ms). */
const REQUEST_TIMEOUT_MS = 15000;

/** Search result cache TTL (10 minutes) + cap to avoid leaks. */
const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_MAX_ENTRIES = 300;

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

let activeCache = { at: 0, urls: [] };

/** In-memory search cache: key `${query}:${limit}` -> { at, data }. */
const searchCache = new Map();

/** Generic words ignored when tokenizing the query (id + en). */
const STOPWORDS = new Set(
  'yang,dan,di,ke,dari,untuk,dengan,adalah,apa,siapa,bagaimana,berapa,yaitu,atau,the,of,and,for,with,what,who,how,are,was,ini,itu,pada,oleh,agar'.split(
    ',',
  ),
);

function cacheGet(key) {
  const hit = searchCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    searchCache.delete(key);
    return null;
  }
  return hit.data;
}

function cacheSet(key, data) {
  if (searchCache.size >= CACHE_MAX_ENTRIES) {
    searchCache.delete(searchCache.keys().next().value);
  }
  searchCache.set(key, { at: Date.now(), data });
}

/**
 * Fetch the pre-checked active instance list (cached 1 hour).
 * Never throws — failure returns the last known list (or empty).
 * @returns {Promise<string[]>} Base URLs (each ends with `/`).
 */
async function getActiveInstances() {
  if (Date.now() - activeCache.at < ACTIVE_TTL_MS && activeCache.urls.length) {
    return activeCache.urls;
  }
  try {
    const res = await fetch(ACTIVE_JSON_URL, {
      headers: { 'user-agent': UA, accept: 'application/json' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`active.json HTTP ${res.status}`);
    const body = await res.json();
    const urls = [...new Set((body?.instances || []).map((i) => i?.url))]
      .filter((u) => typeof u === 'string' && u.startsWith('https://'))
      .map((u) => (u.endsWith('/') ? u : `${u}/`));
    if (urls.length) activeCache = { at: Date.now(), urls };
  } catch {
    /* keep stale cache; caller handles the empty case */
  }
  return activeCache.urls;
}

/** Normalize a URL for cross-instance de-duplication. */
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

/** Site name shown as `source` (hostname without www). */
function sourceOf(u) {
  try {
    return new URL(u).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

/**
 * Query a single instance. Never rejects — any failure
 * (timeout, HTTP error, non-JSON, bad shape) yields an empty list
 * so `Promise.all` still delivers the healthy instances.
 * @param {string} base - Instance base URL (ends with `/`).
 * @param {string} query - Search keywords.
 * @returns {Promise<Array>} Raw normalized hits.
 */
async function fetchFromInstance(base, query) {
  const url = `${base}search?q=${encodeURIComponent(query)}&format=json`;
  try {
    const res = await fetch(url, {
      headers: { 'user-agent': UA, accept: 'application/json' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) return [];
    let body;
    try {
      body = await res.json();
    } catch {
      return [];
    }
    if (!body || !Array.isArray(body.results)) return [];
    const out = [];
    for (const item of body.results) {
      const title = typeof item?.title === 'string' ? item.title.trim() : '';
      const link = typeof item?.url === 'string' ? item.url.trim() : '';
      if (!title || !link || !/^https?:\/\//i.test(link)) continue;
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
      out.push({ title, url: link, snippet, source: sourceOf(link), engine });
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Merge per-instance lists (round-robin interleave + URL dedupe),
 * score each hit against the query, sort most-relevant-first,
 * then slice to `limit` with fresh `rank` numbers.
 */
function mergeRanked(lists, query, limit) {
  const maxLen = Math.max(0, ...lists.map((l) => l.length));
  const pooled = [];
  const seen = new Set();
  const hits = new Map();
  for (let i = 0; i < maxLen; i++) {
    for (const list of lists) {
      const item = list[i];
      if (!item?.url) continue;
      const key = normalizeUrl(item.url);
      hits.set(key, (hits.get(key) || 0) + 1);
      if (seen.has(key)) continue;
      seen.add(key);
      pooled.push({ ...item, _key: key });
    }
  }

  const ql = String(query || '').toLowerCase().trim();
  const tokens = (ql.match(/[a-z\u00c0-\u024f\u1e00-\u1eff]{4,}/g) || []).filter(
    (t) => !STOPWORDS.has(t),
  );

  const scored = pooled.map((item) => {
    const title = String(item.title || '').toLowerCase();
    const snippet = String(item.snippet || '').toLowerCase();
    const url = String(item.url || '').toLowerCase();
    let score = 0;
    let titleHits = 0;
    if (ql && title.includes(ql)) score += 30; // full query phrase in title
    for (const t of tokens) {
      if (title.includes(t)) {
        score += 10;
        titleHits++;
      } else if (snippet.includes(t)) {
        score += 4;
      }
      if (url.includes(t)) score += 2;
    }
    if (tokens.length && titleHits === tokens.length) score += 15; // all tokens in title
    score += (hits.get(item._key) || 1) * 2; // same URL on many instances = relevant
    return { item, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map(({ item }, i) => ({
    title: item.title,
    url: item.url,
    snippet: item.snippet,
    source: item.source,
    ...(item.engine ? { engine: item.engine } : {}),
    rank: i + 1,
  }));
}

/**
 * Search the web via all active SearXNG instances at once.
 * @param {string} query - Search keywords.
 * @param {object} [opts] - Options.
 * @param {number} [opts.limit=10] - Max results (1-20).
 * @returns {Promise<{query:string, count:number, results:Array, source:string, instances_used:number, instances_total:number, cached:boolean}>}
 */
export async function searchSearxngActive(query, opts = {}) {
  const q = String(query || '').trim();
  if (!q) throw new Error("Parameter 'query' is required.");
  const limit = Math.min(Math.max(parseInt(opts.limit, 10) || 10, 1), 20);

  const key = `active:${q.toLowerCase()}:${limit}`;
  const hit = cacheGet(key);
  if (hit) return { ...hit, cached: true };

  const bases = await getActiveInstances();
  if (!bases.length) {
    throw new Error('No active SearXNG instances available, try again later');
  }
  const lists = await Promise.all(bases.map((base) => fetchFromInstance(base, q)));
  const results = mergeRanked(lists, q, limit);
  if (!results.length) {
    throw new Error('No results from SearXNG instances for that query');
  }

  const data = {
    query: q,
    count: results.length,
    results,
    source: 'searxng',
    instances_used: lists.filter((l) => l.length).length,
    instances_total: bases.length,
  };
  cacheSet(key, data);
  return { ...data, cached: false };
}

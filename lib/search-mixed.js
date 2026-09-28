/**
 * Mixed web search: Bing + DuckDuckGo, both rendered in the remote
 * CDP browser (`lib/cdp-browser.js`), merged and relevance-ranked.
 *
 * Both engines are fetched SEQUENTIALLY — the remote browser reuses
 * a single tab, so parallel renders would kill each other's tab
 * via close-all cleanup. One engine failing never fails the other;
 * only when both fail does the search throw (route maps it to 502).
 *
 * Merge: round-robin interleave + URL dedupe, then score every hit
 * against the query (full phrase in title +30, token in title +10,
 * all tokens in title +15, token in snippet +4, token in URL +2,
 * +2 per extra engine sharing the same URL) and sort most-relevant-first.
 */

import { searchBingCdp } from './bing-cdp.js';
import { searchDuckDuckGo } from './duckduckgo-search.js';

/** Search result cache TTL (10 minutes) + cap to avoid leaks. */
const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_MAX_ENTRIES = 300;

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

/** Normalize a URL for cross-engine de-duplication. */
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
 * Merge per-engine lists (round-robin interleave + URL dedupe),
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
    score += (hits.get(item._key) || 1) * 2; // same URL on both engines = relevant
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
 * Search the web via Bing + DuckDuckGo (CDP renders, sequential).
 * @param {string} query - Search keywords.
 * @param {object} [opts] - Options.
 * @param {number} [opts.limit=10] - Max results (1-20).
 * @returns {Promise<{query:string, count:number, results:Array, source:string, providers:Array<string>, cached:boolean}>}
 */
export async function searchWebMixed(query, opts = {}) {
  const q = String(query || '').trim();
  if (!q) throw new Error("Parameter 'query' is required.");
  const limit = Math.min(Math.max(parseInt(opts.limit, 10) || 10, 1), 20);

  const key = `mixed:${q.toLowerCase()}:${limit}`;
  const hit = cacheGet(key);
  if (hit) return { ...hit, cached: true };

  const lists = [];
  const providers = [];
  try {
    const bing = await searchBingCdp(q, { limit });
    if (bing.results?.length) {
      lists.push(bing.results);
      providers.push('bing');
    }
  } catch {
    /* Bing failed — DuckDuckGo still runs */
  }
  try {
    const ddg = await searchDuckDuckGo(q, { limit });
    if (ddg.results?.length) {
      lists.push(ddg.results);
      providers.push('duckduckgo');
    }
  } catch {
    /* DuckDuckGo failed — Bing results (if any) still count */
  }

  const results = mergeRanked(lists, q, limit);
  if (!results.length) throw new Error('No results from Bing/DuckDuckGo (CDP) for that query');

  const data = { query: q, count: results.length, results, source: 'mixed', providers };
  cacheSet(key, data);
  return { ...data, cached: false };
}

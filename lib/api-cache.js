/**
 * Shared in-memory response cache for GET JSON endpoints.
 *
 * Why this exists: every cache miss on a scraper route burns Fluid CPU
 * (fetch upstream HTML, parse, retry). Repeated identical queries — the
 * common case for downloader/search metadata — should not re-run the
 * whole pipeline. Two layers work together:
 *
 * 1. In-memory store here (per serverless instance) with stale-while-
 *    revalidate semantics, so hot keys never block on upstream.
 * 2. `Cache-Control: public, s-maxage=.., stale-while-revalidate=..`
 *    headers, so the Vercel edge network can serve repeats without
 *    invoking the function at all.
 *
 * Rules: only GET, only 2xx JSON responses, never errors. POST bodies,
 * file uploads, SSE/NDJSON streams and personalized endpoints must NOT
 * use this helper.
 */

const MAX_ENTRIES = 500;

// key -> { kind: 'value', value, ... } | { kind: 'json', body, status, headers, ... }
// Every entry carries expiresAt, staleUntil, ttlMs and staleMs.
const store = new Map();

function now() {
  return Date.now();
}

function evictIfNeeded() {
  while (store.size > MAX_ENTRIES) {
    store.delete(store.keys().next().value);
  }
}

function touch(key, entry) {
  // Refresh recency for LRU eviction.
  store.delete(key);
  store.set(key, entry);
}

/**
 * Build a stable cache key from the request URL.
 * Query params are sorted so `?a=1&b=2` and `?b=2&a=1` share one entry.
 * @param {Request|string} req - incoming Request or raw URL string
 * @returns {string} stable cache key
 */
export function cacheKeyForRequest(req) {
  const raw = typeof req === 'string' ? req : req.url;
  const url = new URL(raw, 'http://localhost');
  const params = [...url.searchParams.entries()].sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0
  );
  const query = params
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
  return `GET ${url.pathname}${query ? `?${query}` : ''}`;
}

/**
 * Build a public Cache-Control header for edge + browser caching.
 * @param {number} ttlSeconds - fresh lifetime (s-maxage)
 * @param {number} staleSeconds - stale-while-revalidate window
 * @returns {string} Cache-Control header value
 */
export function cacheControlHeader(ttlSeconds, staleSeconds) {
  return `public, s-maxage=${ttlSeconds}, stale-while-revalidate=${staleSeconds}`;
}

/**
 * Generic memoizer with stale-while-revalidate.
 * Serves stale data instantly while refreshing in the background.
 * @param {string} key - cache key
 * @param {number} ttlMs - fresh lifetime in milliseconds
 * @param {number} staleMs - extra stale lifetime in milliseconds
 * @param {Function} producer - async function producing the value
 * @returns {Promise<{ value: any, hit: 'HIT'|'STALE'|'MISS' }>}
 */
export async function getOrSet(key, ttlMs, staleMs, producer) {
  const at = now();
  const entry = store.get(key);
  if (entry && entry.kind === 'value') {
    if (at < entry.expiresAt) {
      touch(key, entry);
      return { value: entry.value, hit: 'HIT' };
    }
    if (at < entry.staleUntil) {
      refreshValueEntry(key, entry, producer).catch(() => {});
      return { value: entry.value, hit: 'STALE' };
    }
  }
  const value = await producer();
  touch(key, {
    kind: 'value',
    value,
    expiresAt: at + ttlMs,
    staleUntil: at + ttlMs + staleMs,
    ttlMs,
    staleMs,
  });
  evictIfNeeded();
  return { value, hit: 'MISS' };
}

async function refreshValueEntry(key, entry, producer) {
  try {
    const value = await producer();
    const at = now();
    store.set(key, {
      kind: 'value',
      value,
      expiresAt: at + entry.ttlMs,
      staleUntil: at + entry.ttlMs + entry.staleMs,
      ttlMs: entry.ttlMs,
      staleMs: entry.staleMs,
    });
  } catch {
    // Keep serving the stale entry when upstream fails.
  }
}

/**
 * Run a GET JSON producer with caching.
 * The producer must return a Response (e.g. NextResponse.json). Only
 * 2xx JSON responses are stored; anything else passes through uncached.
 * @param {Request} req - incoming GET request (used for the cache key)
 * @param {object} opts
 * @param {number} opts.ttl - fresh lifetime in seconds
 * @param {number} opts.stale - stale-while-revalidate window in seconds
 * @param {Function} producer - async () => Response
 * @returns {Promise<Response>} cached or freshly produced response
 */
export async function cachedJson(req, { ttl, stale }, producer) {
  const key = cacheKeyForRequest(req);
  const at = now();
  const entry = store.get(key);

  if (entry && entry.kind === 'json') {
    if (at < entry.expiresAt) {
      touch(key, entry);
      return jsonFromEntry(entry, 'HIT');
    }
    if (at < entry.staleUntil) {
      refreshJsonEntry(key, entry, producer).catch(() => {});
      return jsonFromEntry(entry, 'STALE');
    }
  }

  const res = await producer();
  const stored = await storeJsonResponse(key, res, ttl, stale);
  if (stored) return jsonFromEntry(store.get(key), 'MISS');
  return res;
}

function jsonFromEntry(entry, hit) {
  const headers = new Headers(entry.headers);
  headers.set('x-cache', hit);
  return new Response(entry.body, { status: entry.status, headers });
}

async function storeJsonResponse(key, res, ttl, stale) {
  try {
    const contentType = res.headers.get('content-type') || '';
    if (!res.ok || !contentType.includes('application/json')) return false;
    const body = await res.text();
    const headers = { 'content-type': 'application/json; charset=utf-8' };
    headers['cache-control'] = res.headers.get('cache-control') || cacheControlHeader(ttl, stale);
    const at = now();
    touch(key, {
      kind: 'json',
      body,
      status: res.status,
      headers,
      expiresAt: at + ttl * 1000,
      staleUntil: at + (ttl + stale) * 1000,
      ttlMs: ttl * 1000,
      staleMs: stale * 1000,
    });
    evictIfNeeded();
    return true;
  } catch {
    return false;
  }
}

async function refreshJsonEntry(key, entry, producer) {
  try {
    const res = await producer();
    const contentType = res.headers.get('content-type') || '';
    if (!res.ok || !contentType.includes('application/json')) return;
    const body = await res.text();
    const at = now();
    store.set(key, {
      kind: 'json',
      body,
      status: res.status,
      headers: entry.headers,
      expiresAt: at + entry.ttlMs,
      staleUntil: at + entry.ttlMs + entry.staleMs,
      ttlMs: entry.ttlMs,
      staleMs: entry.staleMs,
    });
  } catch {
    // Keep the stale entry on upstream failure.
  }
}

/** Test-only hook: clear the whole store. @returns {void} */
export function clearApiCache() {
  store.clear();
}

/** Test-only hook: current entry count. @returns {number} */
export function apiCacheSize() {
  return store.size;
}

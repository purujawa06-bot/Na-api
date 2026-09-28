/**
 * DuckDuckGo search rendered in the remote CDP browser.
 *
 * Transport goes through the shared client (`lib/cdp-browser.js`):
 * the classic HTML endpoint (`html.duckduckgo.com/html/`) is rendered
 * as a real page, then organic hits are parsed server-side with cheerio.
 * Plain Node fetch is intentionally NOT used — DDG blocks datacenter IPs
 * (403/506), which is why the old fetch-based endpoint was removed.
 *
 * No API key, no vqd token dance, no cookies.
 */

import * as cheerio from 'cheerio';
import { fetchHtmlViaCdp } from './cdp-browser.js';

/** Search result cache TTL (10 minutes) + cap to avoid leaks. */
const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_MAX_ENTRIES = 300;

/** In-memory search cache: key `${query}:${limit}` -> { at, data }. */
const searchCache = new Map();

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

/** Normalize a URL for de-duplication. */
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
 * Parse organic hits from rendered DuckDuckGo HTML endpoint.
 * @param {string} html - Full page HTML from `LP.dump`.
 * @returns {Array<{title:string, url:string, snippet:string|null, source:string}>}
 */
export function parseDuckDuckGoResults(html) {
  const $ = cheerio.load(String(html || ''));
  const out = [];
  const seen = new Set();
  $('.result').each((_, el) => {
    const root = $(el);
    const anchor = root.find('a.result__a').first();
    const href = anchor.attr('href') || '';
    if (!href) return;
    const title = anchor.text().replace(/\s+/g, ' ').trim();
    if (!title || title.length < 3) return;
    // Decode DDG redirect (//duckduckgo.com/l/?uddg=<encoded>).
    let url = href;
    const m = href.match(/uddg=([^&]+)/);
    if (m) {
      try {
        url = decodeURIComponent(m[1]);
      } catch {
        /* keep href as-is */
      }
    }
    if (!/^https?:\/\//i.test(url)) return;
    let host = '';
    try {
      host = new URL(url).hostname.toLowerCase();
    } catch {
      return;
    }
    if (/(^|\.)duckduckgo\.com$/i.test(host)) return;
    const key = normalizeUrl(url);
    if (seen.has(key)) return;
    seen.add(key);
    const snippet =
      root.find('.result__snippet').first().text().replace(/\s+/g, ' ').trim().slice(0, 300) ||
      null;
    out.push({ title: title.slice(0, 200), url, snippet, source: host.replace(/^www\./, '') });
  });
  return out;
}

/**
 * Search the web via DuckDuckGo rendered in the remote CDP browser.
 * @param {string} query - Search keywords.
 * @param {object} [opts] - Options.
 * @param {number} [opts.limit=10] - Max results (1-20).
 * @returns {Promise<{query:string, count:number, results:Array, source:string, cached:boolean}>}
 */
export async function searchDuckDuckGo(query, opts = {}) {
  const q = String(query || '').trim();
  if (!q) throw new Error("Parameter 'query' is required.");
  const limit = Math.min(Math.max(parseInt(opts.limit, 10) || 10, 1), 20);

  const key = `ddg-cdp:${q.toLowerCase()}:${limit}`;
  const hit = cacheGet(key);
  if (hit) return { ...hit, cached: true };

  // Shorter load wait: DDG hard-blocks some datacenter IPs at TCP level
  // (navigation never completes), so fail fast and let the mixed
  // search fall back to the surviving engine.
  const html = await fetchHtmlViaCdp(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`, {
    loadTimeoutMs: 8000,
  });
  const parsed = parseDuckDuckGoResults(html).slice(0, limit);
  if (!parsed.length) throw new Error('No results from DuckDuckGo (CDP) for that query');

  const results = parsed.map((r, i) => ({
    title: r.title,
    url: r.url,
    snippet: r.snippet,
    source: r.source || sourceOf(r.url),
    engine: 'duckduckgo',
    rank: i + 1,
  }));
  const data = { query: q, count: results.length, results, source: 'duckduckgo' };
  cacheSet(key, data);
  return { ...data, cached: false };
}

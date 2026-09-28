/**
 * AI-powered web search via the realtime Gemini web backend
 * (lib/gemini-web.js — Bard batchexecute/StreamGenerate, same transport
 * as /api/chat/completions model `gemini-3.6-flash`).
 *
 * The old scraper stack (Bing + DuckDuckGo via remote CDP) is retired:
 * the shared datacenter IP got flagged and Bing started serving rotating
 * decoy result sets, while every alternative engine captcha/TCP-blocks it.
 * Asking the realtime model directly sidesteps IP-based bot walls entirely.
 *
 * Contract mirrors the old mixed search so the route stays compatible:
 * `{ query, count, results[{title,url,snippet,source,engine,rank}],
 *    source, providers, cached }`.
 */
import { generateGemini } from './gemini-web.js';

/** Search result cache TTL (10 minutes) + cap to avoid leaks. */
const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_MAX_ENTRIES = 300;

/** In-memory search cache: key `${query}:${limit}` -> { at, data }. */
const searchCache = new Map();

/** Public model id backing this search (matches /api/chat/completions). */
export const AI_SEARCH_MODEL = 'gemini-3.6-flash';

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
 * Build the search prompt: demand strict JSON only so the answer
 * is machine-parseable without scraping heuristics.
 */
function buildPrompt(query, limit) {
  return [
    'You are a realtime web search engine with live internet knowledge.',
    `Return the top ${limit} most relevant web results for the query: "${query}"`,
    '',
    'Rules:',
    '- Reply with STRICT JSON only, no markdown fences, no commentary:',
    '  {"results":[{"title":"...","url":"https://...","snippet":"..."}]}',
    '- "url" must be the real canonical page URL (http/https), never a redirect, tracker, or markdown link.',
    '- Never invent domains or URLs; only pages you genuinely know exist.',
    '- "title" is the real page title, "snippet" is 1-2 sentences describing why it matches.',
    '- Match the query language when possible (e.g. Indonesian query -> Indonesian pages).',
  ].join('\n');
}

/**
 * Extract the first {...} JSON object from model text (tolerates
 * leading/trailing prose and code fences).
 * @throws when no parseable object with a results array is found.
 */
function extractResults(text) {
  const clean = String(text ?? '')
    .replace(/```(?:json)?/gi, '')
    .trim();
  const start = clean.indexOf('{');
  const end = clean.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('AI search returned no JSON object');
  let parsed;
  try {
    parsed = JSON.parse(clean.slice(start, end + 1));
  } catch {
    throw new Error('AI search returned malformed JSON');
  }
  const list = Array.isArray(parsed) ? parsed : parsed?.results;
  if (!Array.isArray(list) || !list.length) throw new Error('AI search returned an empty result list');
  return list;
}

function isHttpUrl(u) {
  try {
    const p = new URL(String(u ?? '').trim());
    return p.protocol === 'http:' || p.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Search the web through the realtime AI provider.
 * @param {string} query - Search keywords.
 * @param {object} [opts] - Options.
 * @param {number} [opts.limit=10] - Max results (1-20).
 * @returns {Promise<{query:string, count:number, results:Array, source:string, providers:Array<string>, cached:boolean}>}
 */
export async function searchWebViaAi(query, opts = {}) {
  const q = String(query || '').trim();
  if (!q) throw new Error("Parameter 'query' is required.");
  const limit = Math.min(Math.max(parseInt(opts.limit, 10) || 10, 1), 20);

  const key = `ai:${q.toLowerCase()}:${limit}`;
  const hit = cacheGet(key);
  if (hit) return { ...hit, cached: true };

  const { text } = await generateGemini({
    prompt: buildPrompt(q, limit),
    modelCode: 0,
    jarModel: AI_SEARCH_MODEL,
  });
  const raw = extractResults(text);

  const seen = new Set();
  const results = [];
  for (const item of raw) {
    if (results.length >= limit) break;
    const url = String(item?.url ?? '').trim();
    if (!isHttpUrl(url)) continue;
    const dedupe = url.toLowerCase().replace(/\/+$/, '');
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    results.push({
      title: String(item?.title ?? url).trim().slice(0, 200) || url,
      url,
      snippet: String(item?.snippet ?? '').trim().slice(0, 500),
      source: 'ai',
      engine: AI_SEARCH_MODEL,
      rank: results.length + 1,
    });
  }
  if (!results.length) throw new Error('AI search returned no usable results for that query');

  const data = { query: q, count: results.length, results, source: 'ai', providers: [AI_SEARCH_MODEL] };
  cacheSet(key, data);
  return { ...data, cached: false };
}

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
    '- Emit VALID JSON: escape newlines as \\n, no trailing commas, no line breaks inside strings.',
    '- Match the query language when possible (e.g. Indonesian query -> Indonesian pages).',
  ].join('\n');
}

/**
 * String-aware JSON repair (single pass, never touches string contents
 * except escaping raw control chars):
 * - escapes literal newlines/tabs/CR inside strings (model often emits raw
 *   line breaks in snippets, which breaks JSON.parse),
 * - drops trailing commas before } or ] outside strings.
 */
function repairJson(src) {
  let out = '';
  let inStr = false;
  let esc = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inStr) {
      if (esc) { out += ch; esc = false; continue; }
      if (ch === '\\') { out += ch; esc = true; continue; }
      if (ch === '"') { out += ch; inStr = false; continue; }
      if (ch === '\n') { out += '\\n'; continue; }
      if (ch === '\r') { out += '\\r'; continue; }
      if (ch === '\t') { out += '\\t'; continue; }
      out += ch;
      continue;
    }
    if (ch === '"') { out += ch; inStr = true; continue; }
    // trailing comma outside strings: skip when only whitespace then } or ]
    if (ch === ',') {
      let j = i + 1;
      while (j < src.length && /\s/.test(src[j])) j++;
      if (src[j] === '}' || src[j] === ']') continue;
    }
    out += ch;
  }
  return out;
}

/**
 * Slice the first balanced {...} object starting at `start`
 * (string- and escape-aware, so braces inside strings don't count).
 * @returns {string|null} the object slice, or null when unbalanced/truncated.
 */
function sliceBalanced(src, start) {
  let inStr = false;
  let esc = false;
  let depth = 0;
  for (let i = start; i < src.length; i++) {
    const ch = src[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  return null;
}

/**
 * Last-resort extractor for truncated/malformed answers: pull out every
 * complete {"title","url","snippet"} triple via regex, ignoring the broken
 * tail. Tolerates missing snippet.
 * @returns {Array} possibly empty list of raw item objects.
 */
function extractResultsLoose(text) {
  const items = [];
  const re = /"title"\s*:\s*"((?:[^"\\]|\\.)*)"\s*,\s*"url"\s*:\s*"((?:[^"\\]|\\.)*)"(?:\s*,\s*"snippet"\s*:\s*"((?:[^"\\]|\\.)*)")?/g;
  let m;
  const unescape = (s) => {
    try { return JSON.parse(`"${s}"`); } catch { return s; }
  };
  while ((m = re.exec(text)) !== null) {
    items.push({ title: unescape(m[1]), url: unescape(m[2]), snippet: m[3] ? unescape(m[3]) : '' });
    if (items.length >= 20) break;
  }
  return items;
}

/**
 * Extract the result list from model text (tolerates leading/trailing
 * prose, code fences, raw line breaks in strings, trailing commas,
 * and truncated tails via regex fallback).
 * @throws when nothing usable is found.
 */
function extractResults(text) {
  const clean = String(text ?? '')
    .replace(/```(?:json)?/gi, '')
    .trim();
  const start = clean.indexOf('{');
  if (start < 0) throw new Error('AI search returned no JSON object');
  const slice = sliceBalanced(clean, start) ?? clean.slice(start);
  const attempts = [slice, repairJson(slice)];
  for (const candidate of attempts) {
    try {
      const parsed = JSON.parse(candidate);
      const list = Array.isArray(parsed) ? parsed : parsed?.results;
      if (Array.isArray(list) && list.length) return list;
    } catch { /* try next repair level */ }
  }
  const loose = extractResultsLoose(clean);
  if (loose.length) return loose;
  throw new Error('AI search returned malformed JSON');
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

  // The model occasionally emits malformed JSON — retry with a fresh call
  // (up to 3 attempts) before giving up; each attempt also runs the
  // tolerant parser (repair + regex fallback) first.
  let raw = null;
  let lastErr = null;
  for (let attempt = 1; attempt <= 3 && !raw; attempt++) {
    try {
      const { text } = await generateGemini({
        prompt: buildPrompt(q, limit),
        modelCode: 0,
        jarModel: AI_SEARCH_MODEL,
      });
      raw = extractResults(text);
    } catch (err) {
      lastErr = err;
      if (attempt < 3) console.error(`[ai-search] attempt ${attempt} failed (${err?.message ?? err}), retrying...`);
    }
  }
  if (!raw) throw lastErr ?? new Error('AI search returned no usable results for that query');

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

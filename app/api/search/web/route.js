/**
 * @title Web Search
 * @summary Search the web via the realtime AI provider (same Bard backend as chat completions).
 * @description Search keywords are answered by the realtime Gemini web model
 *              (lib/gemini-web.js — Bard batchexecute/StreamGenerate, the same
 *              transport as /api/chat/completions model gemini-3.6-flash),
 *              which returns the most relevant live web pages as strict JSON.
 *              Hits are validated server-side (real http/https URLs, de-duplicated)
 *              and ranked in the requested order. No scraper, no CAPTCHA wall.
 * @method GET
 * @path /api/search/web
 * @param {string} query.query - Search keywords (required, alias: q).
 * @param {number} [query.limit] - Max total results (default 10, max 20, alias: result, count).
 * @response json
 * @example
 * fetch('https://puruboy-api.vercel.app/api/search/web?query=nodejs+tutorial&limit=10')
 *     .then(res => res.json())
 *     .then(data => console.log(data));
 */
import { searchWebViaAi } from '../../../../lib/ai-search.js';
import { cachedJson } from '../../../../lib/api-cache.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

function parseQuery(searchParams) {
  const query = (searchParams.get('query') ?? searchParams.get('q') ?? '').trim();
  if (!query) {
    return { error: { success: false, error: "Parameter 'query' is required." }, status: 400 };
  }
  if (query.length > 200) {
    return { error: { success: false, error: 'Query too long (max 200 characters).' }, status: 400 };
  }

  const rawLimit = searchParams.get('limit') ?? searchParams.get('result') ?? searchParams.get('count') ?? '10';
  let limit = parseInt(rawLimit, 10);
  if (Number.isNaN(limit)) limit = 10;
  limit = Math.min(Math.max(limit, 1), 20);

  return { params: { query, limit } };
}

async function runSearch(params) {
  const searched = await searchWebViaAi(params.query, { limit: params.limit });
  return Response.json({
    success: true,
    status: 'success',
    query: searched.query,
    count: searched.count,
    results: searched.results,
    source: searched.source,
    providers: searched.providers,
    limit: params.limit,
  });
}

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const parsed = parseQuery(searchParams);
  if (parsed.error) {
    return Response.json(parsed.error, { status: parsed.status });
  }
  // The AI call is the most expensive per-hit cost here; lib already holds
  // a 10 min memory cache, this layer adds edge caching on top of it.
  return cachedJson(req, { ttl: 600, stale: 300 }, async () => {
    try {
      return await runSearch(parsed.params);
    } catch (err) {
      const status = err?.status === 400 ? 400 : 502;
      return Response.json({ success: false, status: 'error', error: err.message, httpStatus: status }, { status });
    }
  });
}

export async function POST(req) {
  let body;
  try {
    body = await req.json();
  } catch {
    return Response.json({ success: false, error: 'Body must be JSON: {"query": "...", "limit": 10}' }, { status: 400 });
  }
  const sp = new URLSearchParams();
  if (body?.query ?? body?.q) sp.set('query', body.query ?? body.q);
  if (body?.limit ?? body?.result ?? body?.count) sp.set('limit', String(body.limit ?? body.result ?? body.count));
  const parsed = parseQuery(sp);
  if (parsed.error) {
    return Response.json(parsed.error, { status: parsed.status });
  }
  try {
    return await runSearch(parsed.params);
  } catch (err) {
    const status = err?.status === 400 ? 400 : 502;
    return Response.json({ success: false, status: 'error', error: err.message, httpStatus: status }, { status });
  }
}

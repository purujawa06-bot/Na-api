/**
 * @title Web Search
 * @summary Search the web via pre-checked SearXNG instances (no API key).
 * @description All active instances from the daily-checked registry
 *              (SearXNG-active-instance/active.json) are queried in parallel
 *              via Promise.all; results are merged, de-duplicated by URL,
 *              then sorted by relevance score so the most relevant hits
 *              move to the top. Plain SearXNG JSON API, no cookies or scraping.
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
import { searchSearxngActive } from '../../../../lib/searxng-active.js';

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
  const searched = await searchSearxngActive(params.query, { limit: params.limit });
  return Response.json({
    success: true,
    status: 'success',
    query: searched.query,
    count: searched.count,
    results: searched.results,
    source: searched.source,
    instances_used: searched.instances_used,
    instances_total: searched.instances_total,
    limit: params.limit,
  });
}

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const parsed = parseQuery(searchParams);
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

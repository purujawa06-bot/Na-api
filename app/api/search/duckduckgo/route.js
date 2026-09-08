/**
 * @title Web Search (Bing)
 * @summary Cari di Bing tanpa API key.
 * @description Mencari di mesin pencari Bing tanpa API key. Menggunakan
 *              scraping HTML Bing yang reliable dari serverless/Vercel.
 *              Retry 3x dengan backoff eksponensial jika terkena rate-limit.
 *              Respons berupa JSON biasa (bukan SSE/streaming).
 * @method GET
 * @path /api/search/duckduckgo
 * @param {string} query.q - Kata kunci pencarian (wajib).
 * @param {number} [query.limit] - Jumlah hasil maks (default 10, maks 20).
 * @response json
 * @example
 * fetch('https://nexta-api.vercel.app/api/search/duckduckgo?q=nodejs+tutorial&limit=5')
 *     .then(res => res.json())
 *     .then(data => console.log(data));
 */
import { searchBing } from '../../../../lib/bing-search.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

function parseQuery(searchParams) {
  const q = searchParams.get('q');
  if (!q || typeof q !== 'string' || !q.trim()) {
    return { error: { success: false, error: 'Parameter q wajib diisi' }, status: 400 };
  }
  if (q.length > 200) {
    return { error: { success: false, error: 'Query terlalu panjang (maks 200 karakter)' }, status: 400 };
  }
  const limit = Number(searchParams.get('limit')) || 10;
  return { params: { q: q.trim(), limit } };
}

async function runSearch(params) {
  const result = await searchBing(params.q, {
    limit: params.limit,
    onRetry: () => {}, // retry tetap jalan, tanpa streaming progress
  });
  return Response.json({ success: true, status: 'success', ...result });
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
    return Response.json({ success: false, error: 'Body harus JSON: {"q": "..."}' }, { status: 400 });
  }
  const sp = new URLSearchParams();
  if (body?.q) sp.set('q', body.q);
  if (body?.limit != null) sp.set('limit', String(body.limit));
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
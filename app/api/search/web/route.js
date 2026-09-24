/**
 * @title Web Search
 * @summary Cari web via SearXNG multi-instance + fallback Wikipedia (tanpa API key).
 * @description Mencari via beberapa instance SearXNG publik yang dipanggil
 *              bersamaan (Promise.all, timeout 5 detik per instance).
 *              Hasil digabung, diverifikasi, didedupe, dan di-ranking
 *              sehingga yang paling relevan di paling atas (maks 10 URL);
 *              hasil di-cache di memori selama proses Vercel masih jalan.
 *              Bila semua instance gagal/tak relevan (termasuk typo huruf
 *              ganda yang dikoreksi otomatis), fallback ke Wikipedia
 *              (flag `fallback: 'wikipedia'`, koreksi ditandai
 *              `corrected_from`). Respons JSON biasa. Default bahasa
 *              Indonesia.
 * @method GET
 * @path /api/search/web
 * @param {string} query.query - Kata kunci pencarian (wajib, alias: q).
 * @param {string} [query.lang] - Bahasa hasil: id | en (default id).
 * @param {number} [query.limit] - Jumlah hasil maks (default 5, maks 20, alias: result, count).
 * @response json
 * @example
 * fetch('https://puruboy-api.vercel.app/api/search/web?query=nodejs+tutorial&lang=id&limit=5')
 *     .then(res => res.json())
 *     .then(data => console.log(data));
 */
import { searchSearxng } from '../../../../lib/searxng.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

function parseQuery(searchParams) {
  const query = (searchParams.get('query') ?? searchParams.get('q') ?? '').trim();
  if (!query) {
    return { error: { success: false, error: 'Parameter query wajib diisi' }, status: 400 };
  }
  if (query.length > 200) {
    return { error: { success: false, error: 'Query terlalu panjang (maks 200 karakter)' }, status: 400 };
  }
  let lang = (searchParams.get('lang') || 'id').trim().toLowerCase();
  if (lang !== 'id' && lang !== 'en') lang = 'id';

  const rawLimit = searchParams.get('limit') ?? searchParams.get('result') ?? searchParams.get('count') ?? '5';
  let limit = parseInt(rawLimit, 10);
  if (Number.isNaN(limit)) limit = 5;
  limit = Math.min(Math.max(limit, 1), 20);

  return { params: { query, lang, limit } };
}

async function runSearch(params) {
  const result = await searchSearxng(params.query, {
    limit: params.limit,
    lang: params.lang,
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
    return Response.json({ success: false, error: 'Body harus JSON: {"query": "...", "lang": "id", "limit": 5}' }, { status: 400 });
  }
  const sp = new URLSearchParams();
  if (body?.query ?? body?.q) sp.set('query', body.query ?? body.q);
  if (body?.lang != null) sp.set('lang', String(body.lang));
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

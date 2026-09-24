/**
 * @title Web Search
 * @summary Cari web murni via scraping Yahoo / Baidu (tanpa API key).
 * @description Murni scraping halaman hasil dengan bypass guard
 *              (cookie sesi persisten di Firebase + refresh otomatis
 *              bila invalid, rotasi UA, jeda sopan, retry 1x).
 *              Provider dipilih via param `provider` (yahoo | baidu,
 *              default yahoo); bila provider pilihan buntu (diblokir/
 *              kosong), otomatis dicoba provider satunya
 *              (ditandai `fallback_provider`). Blok hasil organik
 *              di-parse (judul, URL asli, snippet, nama situs),
 *              didedupe, lalu diambil N teratas sesuai urutan ranking
 *              asli provider (maks 10 URL); hasil di-cache di memori
 *              selama proses Vercel masih jalan. Typo huruf ganda
 *              dikoreksi otomatis 1x retry (ditandai `corrected_from`).
 *              Default bahasa Indonesia.
 * @method GET
 * @path /api/search/web
 * @param {string} query.query - Kata kunci pencarian (wajib, alias: q).
 * @param {string} [query.provider] - Provider: yahoo | baidu (default yahoo).
 * @param {string} [query.lang] - Bahasa hasil: id | en (default id; khusus Yahoo).
 * @param {number} [query.limit] - Jumlah hasil maks (default 5, maks 20, alias: result, count).
 * @response json
 * @example
 * fetch('https://puruboy-api.vercel.app/api/search/web?query=nodejs+tutorial&lang=id&limit=5')
 *     .then(res => res.json())
 *     .then(data => console.log(data));
 */
import { searchYahoo } from '../../../../lib/yahoo-scrape.js';
import { searchBaidu } from '../../../../lib/baidu-scrape.js';
import { suggestCorrection } from '../../../../lib/bing-search.js';

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

  // Provider: yahoo | baidu (selain itu default yahoo).
  const rawProvider = (searchParams.get('provider') || 'yahoo').trim().toLowerCase();
  const provider = rawProvider === 'baidu' ? 'baidu' : 'yahoo';

  return { params: { query, lang, limit, provider } };
}

const SEARCHERS = { yahoo: searchYahoo, baidu: searchBaidu };

async function runSearch(params) {
  const primary = params.provider;
  const secondary = primary === 'yahoo' ? 'baidu' : 'yahoo';
  const opts = { limit: params.limit, lang: params.lang };

  // 1. Provider pilihan.
  let result = await SEARCHERS[primary](params.query, opts);

  // 2. Pemulih typo: koreksi huruf ganda (mis. "penemuu" -> "penemu") lalu retry 1x.
  if (!result.success && result.error === 'no_results') {
    const fixed = suggestCorrection(params.query);
    if (fixed && fixed !== params.query) {
      const retried = await SEARCHERS[primary](fixed, opts);
      if (retried.success) result = { ...retried, corrected_from: params.query };
    }
  }

  // 3. Provider pilihan buntu (diblokir/kosong) -> otomatis coba provider satunya.
  if (!result.success) {
    const alt = await SEARCHERS[secondary](params.query, opts);
    if (alt.success) {
      result = { ...alt, fallback_provider: secondary };
    }
  }

  if (!result.success) {
    const err = new Error(
      /_blocked$/.test(result.error || '')
        ? 'Yahoo & Baidu memblokir permintaan (guard), coba lagi nanti'
        : 'Tidak ada hasil dari Yahoo/Baidu untuk query tersebut',
    );
    err.status = 502;
    throw err;
  }
  return Response.json({ success: true, status: 'success', provider: result.source, ...result });
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
    return Response.json({ success: false, error: 'Body harus JSON: {"query": "...", "provider": "yahoo|baidu", "lang": "id", "limit": 5}' }, { status: 400 });
  }
  const sp = new URLSearchParams();
  if (body?.query ?? body?.q) sp.set('query', body.query ?? body.q);
  if (body?.provider != null) sp.set('provider', String(body.provider));
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

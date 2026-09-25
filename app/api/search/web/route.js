/**
 * @title Web Search
 * @summary Cari web via SearXNG Puru (tanpa API key).
 * @description Satu provider tetap: https://searxng-puru.onrender.com/search?q=<query>&format=json
 *              (format JSON SearXNG: { query, results: [{ title, url, content, engine }] }).
 *              Hasil dipetakan ke kontrak lama agar KONSISTEN (bentuk respon tidak berubah):
 *              SATU array yang DIURUTKAN berdasar skor relevansi terhadap query
 *              (frasa utuh di judul +30, token di judul +10, semua token di judul +15,
 *              token di snippet +4, token di URL +2; dedupe URL, total maks 3x limit, cap 20;
 *              tiap item ada field `engine` dari SearXNG).
 *              Default bahasa Indonesia.
 * @method GET
 * @path /api/search/web
 * @param {string} query.query - Kata kunci pencarian (wajib, alias: q).
 * @param {string} [query.lang] - Bahasa hasil: id | en (default id; diteruskan sebagai language ke SearXNG).
 * @param {number} [query.limit] - Jumlah hasil maks (default 5, maks 10, alias: result, count).
 * @response json
 * @example
 * fetch('https://puruboy-api.vercel.app/api/search/web?query=nodejs+tutorial&lang=id&limit=5')
 *     .then(res => res.json())
 *     .then(data => console.log(data));
 */
import { searchSearxngPuru } from '../../../../lib/searxng-puru.js';

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
  limit = Math.min(Math.max(limit, 1), 10);

  return { params: { query, lang, limit } };
}

/** Normalisasi URL untuk dedupe. */
function normalizeMix(u) {
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

/** Kata generik yang diabaikan saat tokenisasi query (id + en). */
const STOPWORDS = new Set(
  'yang,dan,di,ke,dari,untuk,dengan,adalah,apa,siapa,bagaimana,berapa,yaitu,atau,the,of,and,for,with,what,who,how,are,was,ini,itu,pada,oleh,agar'.split(
    ',',
  ),
);

/**
 * Urutkan hasil SearXNG berdasar SKOR RELEVANSI terhadap query
 * (paling relevan di paling atas): dedupe URL -> skor tiap item ->
 * sort menurun -> potong `cap` -> `rank` ulang.
 */
function rankResults(items, query, cap) {
  const seen = new Set();
  const pooled = [];
  for (const item of items || []) {
    if (!item?.url) continue;
    const key = normalizeMix(item.url);
    if (seen.has(key)) continue;
    seen.add(key);
    pooled.push(item);
  }
  const ql = String(query || '').toLowerCase().trim();
  const tokens = (ql.match(/[a-z\u00c0-\u024f\u1e00-\u1eff]{4,}/g) || []).filter(
    (t) => !STOPWORDS.has(t),
  );
  const scored = pooled.map((item) => {
    const title = String(item.title || '').toLowerCase();
    const snippet = String(item.snippet || '').toLowerCase();
    const url = String(item.url || '').toLowerCase();
    let s = 0;
    let titleHits = 0;
    if (ql && title.includes(ql)) s += 30; // frasa query utuh di judul
    for (const t of tokens) {
      if (title.includes(t)) {
        s += 10;
        titleHits++;
      } else if (snippet.includes(t)) {
        s += 4;
      }
      if (url.includes(t)) s += 2;
    }
    if (tokens.length && titleHits === tokens.length) s += 15; // semua token di judul
    return { item, s };
  });
  scored.sort((a, b) => b.s - a.s);
  return scored.slice(0, cap).map(({ item }, i) => ({ ...item, rank: i + 1 }));
}

async function runSearch(params) {
  const cap = Math.min(params.limit * 3, 20);

  // Satu provider tetap (SearXNG Puru); minta langsung `cap` hasil
  // agar total hasil sama seperti kontrak lama (maks 3x limit, cap 20).
  const res = await searchSearxngPuru(params.query, { limit: cap, lang: params.lang });
  if (!res.success) {
    const err = new Error(
      /_blocked$|_challenge$/.test(res.error || '')
        ? 'Semua provider memblokir permintaan (guard), coba lagi nanti'
        : 'Tidak ada hasil dari provider untuk query tersebut',
    );
    err.status = 502;
    throw err;
  }

  const results = rankResults(res.results, params.query, cap);
  if (!results.length) {
    const err = new Error('Tidak ada hasil dari provider untuk query tersebut');
    err.status = 502;
    throw err;
  }
  return Response.json({
    success: true,
    status: 'success',
    query: params.query,
    count: results.length,
    results,
    source: 'mixed',
    providers: ['searxng'],
    limit_per_provider: params.limit,
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

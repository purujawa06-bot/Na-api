/**
 * @title Web Search
 * @summary Cari web murni via Baidu + Bing + Wikipedia sekaligus (tanpa API key).
 * @description Baidu/Bing murni scraping halaman hasil dengan
 *              bypass guard (cookie sesi persisten di Firebase + refresh
 *              otomatis bila invalid, rotasi UA, jeda sopan, retry 1x;
 *              Bing juga menolak mode degradasi via cek relevansi);
 *              Wikipedia via MediaWiki API resmi (tanpa guard).
 *              Ketiga provider selalu ditembak BERSAMAAN via Promise.all;
 *              masing-masing menyumbang maksimal `limit` hasil yang
 *              digabung ke dalam SATU array lalu DIURUTKAN berdasar
 *              skor relevansi terhadap query (dedupe URL, total maks
 *              3x limit, cap 20; skor seri mempertahankan urutan
 *              selang-seling agar beragam). Blok hasil organik di-parse
 *              (judul, URL asli, snippet, nama situs; tiap item ada
 *              field `engine`: baidu | bing | wikipedia).
 *              Typo huruf ganda dikoreksi otomatis 1x retry
 *              (ditandai `corrected_from`). Satu/lebih provider diblokir
 *              tak menggagalkan yang lain. Default bahasa Indonesia.
 * @method GET
 * @path /api/search/web
 * @param {string} query.query - Kata kunci pencarian (wajib, alias: q).
 * @param {string} [query.lang] - Bahasa hasil: id | en (default id; khusus Wikipedia).
 * @param {number} [query.limit] - Jumlah hasil maks PER PROVIDER (default 5, maks 10, alias: result, count).
 * @response json
 * @example
 * fetch('https://puruboy-api.vercel.app/api/search/web?query=nodejs+tutorial&lang=id&limit=5')
 *     .then(res => res.json())
 *     .then(data => console.log(data));
 */
import { searchBaidu } from '../../../../lib/baidu-scrape.js';
import { searchBing } from '../../../../lib/bing-scrape.js';
import { searchWikipedia } from '../../../../lib/wikipedia-search.js';
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
  limit = Math.min(Math.max(limit, 1), 10);

  return { params: { query, lang, limit } };
}

/** Normalisasi URL untuk dedupe gabungan. */
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
 * Gabung hasil SEMUA provider ke SATU array yang diurutkan berdasar
 * SKOR RELEVANSI terhadap query (paling relevan di paling atas,
 * bukan selang-seling provider): dedupe URL -> skor tiap item ->
 * sort menurun -> potong `cap` -> `rank` ulang.
 * Sort stabil: skor seri mempertahankan urutan selang-seling
 * (1 Baidu, 1 Bing, 1 Wikipedia, 2 Baidu, ...) agar beragam.
 * Satu provider gagal = kontribusi nol, provider lain tetap jalan.
 */
function mergeRanked(providers, query, cap) {
  const lists = (providers || []).map((p) => p?.results || []);
  const maxLen = Math.max(0, ...lists.map((l) => l.length));
  const pooled = [];
  const seen = new Set();
  for (let i = 0; i < maxLen; i++) {
    for (const list of lists) {
      const item = list[i];
      if (!item?.url) continue;
      const key = normalizeMix(item.url);
      if (seen.has(key)) continue;
      seen.add(key);
      pooled.push(item);
    }
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

/** Relevan bila minimal 1 kata query (huruf, >=4) muncul di judul/snippet. */
function looksRelevant(results, query) {
  const words = String(query || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .filter((w) => /^[a-z]+$/.test(w) && w.length >= 4);
  if (!words.length) return true;
  const blob = results
    .map((r) => `${r.title || ''} ${r.snippet || ''}`.toLowerCase())
    .join(' ');
  return words.some((w) => blob.includes(w));
}

async function runSearch(params) {
  const opts = { limit: params.limit, lang: params.lang };
  const cap = Math.min(params.limit * 3, 20);

  // 1. Tembak ketiganya bersamaan; masing-masing nyumbang maks `limit`.
  let providers = await Promise.all([
    searchBaidu(params.query, opts),
    searchBing(params.query, opts),
    searchWikipedia(params.query, opts),
  ]);
  // 2. Pemulih typo: bila hasil nihil ATAU tak relevan (mis. Baidu
  //    mengembalikan hasil asal untuk query typo "penemuu"), koreksi
  //    huruf ganda lalu retry semuanya 1x.
  let correctedFrom = null;
  let effectiveQuery = params.query;
  const fixed = suggestCorrection(params.query);
  const needsFix =
    fixed &&
    fixed !== params.query &&
    (!providers.every((p) => p.success) ||
      !looksRelevant(mergeRanked(providers, params.query, cap), params.query));
  if (needsFix) {
    providers = await Promise.all([
      searchBaidu(fixed, opts),
      searchBing(fixed, opts),
      searchWikipedia(fixed, opts),
    ]);
    if (providers.some((p) => p.success)) {
      correctedFrom = params.query;
      effectiveQuery = fixed; // skor relevansi memakai ejaan yang benar
    }
  }

  const results = mergeRanked(providers, effectiveQuery, cap);
  if (!results.length) {
    const guard = providers.every((p) => /_blocked$|_challenge$/.test(p.error || ''));
    const err = new Error(
      guard
        ? 'Semua provider memblokir permintaan (guard), coba lagi nanti'
        : 'Tidak ada hasil dari provider untuk query tersebut',
    );
    err.status = 502;
    throw err;
  }
  const used = providers.filter((p) => p.success).map((p) => p.source);
  return Response.json({
    success: true,
    status: 'success',
    query: params.query,
    count: results.length,
    results,
    source: 'mixed',
    providers: used,
    limit_per_provider: params.limit,
    ...(correctedFrom ? { corrected_from: correctedFrom } : {}),
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

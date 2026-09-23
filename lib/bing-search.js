/**
 * Web search via Bing — tanpa API key.
 *
 * Strategi ganda (HTML + RSS) karena relevansi Bing dari IP datacenter US
 * tidak stabil untuk query Indonesia multi-kata:
 *   - HTML kadang "Tidak ada hasil" / hasil ngaco (mis. "membuat rendang"
 *     -> 0 hasil, "cara membuat rendang" -> cuma match kata "cara").
 *   - RSS (?format=rss) ringan, URL langsung (tanpa redirect /ck/a),
 *     kadang justru pas untuk query yang gagal di HTML.
 * Hasil digabung, dedupe, lalu di-ranking berdasarkan kecocokan kata query
 * di title/snippet/url supaya yang paling relevan naik ke atas.
 *
 * Param cc/setlang/mkt sengaja TIDAK dipakai: terbukti bikin hasil makin
 * ngaco (query pecah, 0 hasil). Lang hanya via header Accept-Language.
 */

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

function buildHeaders(lang) {
  return {
    'user-agent': UA,
    accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'accept-language': lang === 'id' ? 'id-ID,id;q=0.9,en-US;q=0.8' : 'en-US,en;q=0.9',
    'accept-encoding': 'gzip, deflate, br',
  };
}

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function decodeHtmlEntities(str) {
  return str
    .replace(/<!\[CDATA\[/g, '')
    .replace(/\]\]>/g, '')
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, '/')
    .replace(/&#x2f;/g, '/')
    .replace(/&#0183;/g, '·')
    .replace(/&#32;/g, ' ')
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Decode URL redirect Bing (/ck/a?...u=<base64url>).
 * Jika bukan redirect Bing, kembalikan apa adanya.
 */
function decodeBingUrl(url) {
  if (!url.includes('bing.com/ck/a')) return url;
  try {
    const u = new URL(url);
    const enc = u.searchParams.get('u');
    if (enc) {
      // Bing pakai base64url (tanpa padding). Kadang ada prefix 'a1'.
      let b64 = enc.replace(/^a1/, '').replace(/-/g, '+').replace(/_/g, '/');
      while (b64.length % 4 !== 0) b64 += '=';
      const decoded = Buffer.from(b64, 'base64').toString('utf-8');
      if (decoded.startsWith('http')) return decoded;
    }
  } catch {
    /* fallback ke URL asli */
  }
  return url;
}

/**
 * Parse hasil pencarian dari HTML Bing.
 * Hasil ada dalam <li class="b_algo"> dengan <h2><a href="...">Title</a></h2>
 * dan snippet di <p> di dalam block.
 */
function parseBingResults(html) {
  const results = [];
  const seen = new Set();

  // Ambil semua block <li class="b_algo"> (atribut bisa bervariasi)
  const algoBlocks = html.match(/<li class="b_algo"[^>]*>[\s\S]*?<\/li>/gi) || [];

  for (const block of algoBlocks) {
    // URL + title dari <h2><a href="...">
    const linkMatch = block.match(/<h2[^>]*>\s*<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!linkMatch) continue;

    let url = decodeHtmlEntities(linkMatch[1].trim());
    url = decodeBingUrl(url);
    const title = decodeHtmlEntities(linkMatch[2]);

    if (!url || !title) continue;
    if (seen.has(url)) continue;
    seen.add(url);

    // Snippet dari <p> pertama dalam block
    let snippet = null;
    const snippetMatch = block.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
    if (snippetMatch) {
      snippet = decodeHtmlEntities(snippetMatch[1]) || null;
    }

    results.push({ title, url, snippet });
  }

  return results;
}

/**
 * Parse hasil dari Bing RSS (?format=rss).
 * Ringan: <item><title>..<link>..<description>.., URL langsung tanpa redirect.
 */
function parseRssResults(xml) {
  const results = [];
  const seen = new Set();
  const items = xml.match(/<item>[\s\S]*?<\/item>/gi) || [];

  for (const item of items) {
    const t = item.match(/<title>([\s\S]*?)<\/title>/i);
    const l = item.match(/<link>([\s\S]*?)<\/link>/i);
    const d = item.match(/<description>([\s\S]*?)<\/description>/i);
    if (!t || !l) continue;

    const title = decodeHtmlEntities(t[1]);
    const url = decodeHtmlEntities(l[1].trim());
    const snippet = d ? decodeHtmlEntities(d[1]) || null : null;

    if (!url || !title) continue;
    if (!/^https?:\/\//i.test(url)) continue;
    if (seen.has(url)) continue;
    seen.add(url);

    results.push({ title, url, snippet });
  }

  return results;
}

/** Normalisasi URL untuk dedupe antar sumber. */
function normalizeUrl(u) {
  try {
    const p = new URL(u);
    const host = p.hostname.toLowerCase().replace(/^www\./, '');
    let path = p.pathname.replace(/\/+$/, '');
    if (path === '') path = '/';
    return `${host}${path}`.toLowerCase();
  } catch {
    return u.trim().toLowerCase().replace(/\/+$/, '');
  }
}

/** Skor relevansi: kecocokan tiap kata query di title/snippet/url. */
function scoreResult(r, words) {
  const title = (r.title || '').toLowerCase();
  const snippet = (r.snippet || '').toLowerCase();
  const url = (r.url || '').toLowerCase();
  let score = 0;
  for (const w of words) {
    if (title.includes(w)) score += 3;
    if (snippet.includes(w)) score += 1;
    if (url.includes(w)) score += 1;
  }
  return score;
}

/** GET dengan retry 3x + backoff. Hanya 429/503 & network error yang di-retry. */
async function fetchText(url, headers) {
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, {
        headers,
        signal: AbortSignal.timeout(15000),
        redirect: 'follow',
      });
      if (res.status === 429 || res.status === 503) {
        throw new Error(`Bing rate-limit (${res.status})`);
      }
      if (!res.ok) {
        const e = new Error(`Bing HTTP ${res.status}`);
        e.fatal = true;
        throw e;
      }
      return await res.text();
    } catch (e) {
      lastErr = e;
      if (e.fatal || attempt === 3) break;
      await delay(1000 * Math.pow(2, attempt - 1));
    }
  }
  throw lastErr || new Error('Gagal menghubungi Bing');
}

/**
 * Cari via Bing (HTML + RSS, digabung & di-ranking).
 * @param {string} query - kata kunci
 * @param {object} [opts]
 * @param {number} [opts.limit=10] - jumlah hasil (1-20)
 * @param {string} [opts.lang='id'] - 'id' atau 'en'
 * @returns {Promise<{source:string, query:string, lang:string, limit:number, result_count:number, results:Array}>}
 */
export async function searchBing(query, opts = {}) {
  if (!query || typeof query !== 'string' || !query.trim()) {
    throw new Error("Parameter 'query' wajib diisi.");
  }
  const limit = Math.min(Math.max(parseInt(opts.limit) || 10, 1), 20);
  const lang = opts.lang === 'en' ? 'en' : 'id';
  // JANGAN pakai cc=/setlang=/mkt= : param itu bikin Bing ngaco
  // di IP datacenter (query multi-kata pecah, b_no / 0 hasil).
  // Lang hanya via header Accept-Language.
  const q = encodeURIComponent(query.trim());
  const htmlUrl = `https://www.bing.com/search?q=${q}&count=${limit + 5}`;
  const rssUrl = `https://www.bing.com/search?format=rss&q=${q}`;
  const headers = buildHeaders(lang);

  // Ambil dua sumber paralel; satu gagal tidak menggagalkan yang lain.
  const [html, xml] = await Promise.all([
    fetchText(htmlUrl, headers).catch(() => null),
    fetchText(rssUrl, headers).catch(() => null),
  ]);

  if (!html && !xml) {
    throw new Error('Gagal menghubungi Bing (HTML+RSS)');
  }

  const merged = [];
  const seen = new Set();
  const push = (r) => {
    if (!r.url || !r.title) return;
    const key = normalizeUrl(r.url);
    if (seen.has(key)) return;
    seen.add(key);
    merged.push(r);
  };

  if (html) parseBingResults(html).forEach(push);
  if (xml) parseRssResults(xml).forEach(push);

  if (merged.length === 0) {
    throw new Error('Bing tidak mengembalikan hasil yang bisa di-parse');
  }

  // Ranking: kata query yang muncul di title/snippet/url menaikkan skor.
  const words = query.toLowerCase().split(/[^a-z0-9]+/i).filter((w) => w.length >= 2);
  merged.forEach((r, i) => {
    r._s = scoreResult(r, words);
    r._i = i;
  });
  merged.sort((a, b) => b._s - a._s || a._i - b._i);

  const results = merged
    .slice(0, limit)
    .map(({ title, url, snippet }) => ({ title, url, snippet }));

  return {
    source: 'bing.com',
    query: query.trim(),
    lang,
    limit,
    result_count: results.length,
    results,
  };
}

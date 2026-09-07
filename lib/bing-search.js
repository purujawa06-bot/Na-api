/**
 * Web search via Bing scraping — tanpa API key.
 *
 * Alur:
 *   1. GET https://www.bing.com/search?q=<query>&count=<limit>
 *   2. Parse HTML, ambil title, url, snippet dari hasil <li class="b_algo">
 *   3. Decode URL redirect Bing (/ck/a?...u=<base64>) ke URL asli
 *
 * Bing jauh lebih ramah ke datacenter/Vercel dibanding DuckDuckGo.
 * Retry 3x dengan backoff eksponensial jika terkena rate-limit.
 */

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const HEADERS = {
  'user-agent': UA,
  accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'accept-language': 'en-US,en;q=0.9',
  'accept-encoding': 'gzip, deflate, br',
};

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function decodeHtmlEntities(str) {
  return str
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, '/')
    .replace(/&#0183;/g, '·')
    .replace(/&#32;/g, ' ')
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
 * Cari via Bing.
 * @param {string} query - kata kunci
 * @param {object} [opts]
 * @param {number} [opts.limit=10] - jumlah hasil (1-20)
 * @param {function} [opts.onRetry] - callback saat retry
 * @returns {Promise<{source:string, query:string, limit:number, result_count:number, results:Array}>}
 */
export async function searchBing(query, opts = {}) {
  if (!query || typeof query !== 'string' || !query.trim()) {
    throw new Error("Parameter 'q' wajib diisi.");
  }
  const limit = Math.min(Math.max(parseInt(opts.limit) || 10, 1), 20);
  const url = `https://www.bing.com/search?q=${encodeURIComponent(query)}&count=${limit + 5}`;

  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      opts.onRetry?.({ attempt });

      const res = await fetch(url, {
        headers: HEADERS,
        signal: AbortSignal.timeout(15000),
        redirect: 'follow',
      });

      if (res.status === 429 || res.status === 503) {
        throw new Error(`Bing rate-limit (${res.status})`);
      }
      if (!res.ok) {
        throw new Error(`Bing HTTP ${res.status}`);
      }

      const html = await res.text();
      const results = parseBingResults(html).slice(0, limit);

      if (results.length > 0) {
        return {
          source: 'bing.com',
          query: query.trim(),
          limit,
          result_count: results.length,
          results,
        };
      }

      throw new Error('Bing tidak mengembalikan hasil yang bisa di-parse');
    } catch (e) {
      lastErr = e;
      if (attempt < 3) await delay(1000 * Math.pow(2, attempt - 1));
    }
  }

  throw lastErr || new Error('Gagal mencari di Bing');
}

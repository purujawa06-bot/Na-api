/**
 * Web search via Bing scraping — tanpa API key.
 *
 * Alur:
 *   1. GET https://www.bing.com/search?q=<query>&count=<limit>
 *   2. Parse HTML, ambil title, url, snippet dari hasil <li class="b_algo">
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
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, '/')
    .replace(/&nbsp;/g, ' ');
}

function stripTags(str) {
  return str.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * Parse hasil pencarian dari HTML Bing.
 * Bing menaruh hasil dalam <li class="b_algo"> dengan:
 *   - <h2><a href="...">Title</a></h2>
 *   - <div class="b_caption"><p>Snippet</p></div>
 * Atau pattern alternatif <li class="b_algo"> dengan struktur berbeda.
 */
function parseBingResults(html) {
  const results = [];
  const seen = new Set();

  // Pattern 1: <li class="b_algo"> ... <h2><a href="URL">TITLE</a></h2> ... <p>SNIPPET</p>
  const algoBlocks = html.match(/<li class="b_algo">[\s\S]*?<\/li>/gi) || [];

  for (const block of algoBlocks) {
    // Extract URL + title from <h2><a href="...">
    const linkMatch = block.match(/<h2[^>]*>\s*<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!linkMatch) continue;

    let url = linkMatch[1].trim();
    const title = stripTags(decodeHtmlEntities(linkMatch[2]));

    // Skip Bing internal links
    if (!url || url.startsWith('/') || url.includes('bing.com') || url.includes('microsoft.com/bing')) continue;
    if (seen.has(url)) continue;
    seen.add(url);

    // Extract snippet from <p> or <div class="b_caption"><p>
    let snippet = '';
    const snippetMatch = block.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
    if (snippetMatch) {
      snippet = stripTags(decodeHtmlEntities(snippetMatch[1]));
    }

    if (title) {
      results.push({ title, url, snippet: snippet || null });
    }
  }

  // Pattern 2: fallback — cari semua <a> dengan href external
  if (results.length === 0) {
    const linkPattern = /<a[^>]+href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    let m;
    while ((m = linkPattern.exec(html)) !== null) {
      const url = m[1];
      const title = stripTags(decodeHtmlEntities(m[2]));
      if (
        !title ||
        !url ||
        url.includes('bing.com') ||
        url.includes('microsoft.com') ||
        url.includes('go.microsoft.com') ||
        seen.has(url)
      )
        continue;
      seen.add(url);
      results.push({ title, url, snippet: null });
    }
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

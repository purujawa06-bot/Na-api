/**
 * Pencarian DuckDuckGo tanpa browser (reverse-engineering).
 *
 * Alur (pola yang sama dipakai library duckduckgo-search populer):
 *   1. GET https://duckduckgo.com/?q=<query> -> ambil token `vqd` dari HTML.
 *   2. GET https://links.duckduckgo.com/d.js?q=<query>&vqd=<vqd>&o=json
 *      -> respons JSON berisi array hasil (field t = title, u = url, a = snippet).
 *   3. Fallback: jika vqd gagal/tidak ketemu, coba endpoint HTML klasik
 *      (html.duckduckgo.com/html/) yang hasilnya di-parse via cheerio.
 *
 * DuckDuckGo memblokir IP datacenter (403/506) pada beberapa endpoint, jadi
 * dipakai retry 5x dengan jeda eksponensial + User-Agent browser.
 */
import * as cheerio from 'cheerio';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const HOME = 'https://duckduckgo.com';
const LINKS_API = 'https://links.duckduckgo.com/d.js';
const HTML_EP = 'https://html.duckduckgo.com/html/';

const HEADERS = {
  'user-agent': UA,
  'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'accept-language': 'en-US,en;q=0.9',
};

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchText(url, { json = false } = {}) {
  const res = await fetch(url, {
    headers: json ? { ...HEADERS, accept: 'application/json,text/html,*/*' } : HEADERS,
    signal: AbortSignal.timeout(15000),
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`DuckDuckGo HTTP ${res.status}`);
  return json ? res.json() : res.text();
}

/** Ambil token vqd dari halaman utama DuckDuckGo. */
async function getVqd(query) {
  const url = `${HOME}/?q=${encodeURIComponent(query)}`;
  const html = await fetchText(url);
  const patterns = [/vqd="([^"]+)"/, /vqd=([^&\s"']+)/, /"vqd":"([^"]+)"/];
  for (const p of patterns) {
    const m = html.match(p);
    if (m && m[1] && m[1].length >= 8) return m[1];
  }
  return null;
}

/** Parsing hasil dari JSON API links.duckduckgo.com/d.js. */
function parseJsonResults(data) {
  const results = [];
  const seen = new Set();
  const rows = Array.isArray(data) ? data : data?.results;
  if (!Array.isArray(rows)) return results;

  for (const row of rows) {
    const href = row?.u;
    if (!href || seen.has(href)) continue;
    seen.add(href);
    const title = (row?.t || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
    const snippet = (row?.a || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim() || null;
    if (!title && !snippet) continue;
    results.push({ title, url: href, snippet });
  }
  return results;
}

/** Parsing hasil dari HTML endpoint html.duckduckgo.com/html/. */
function parseHtmlResults(html) {
  const $ = cheerio.load(html);
  const results = [];
  const seen = new Set();
  $('.result').each(function () {
    const el = $(this);
    const a = el.find('a.result__a').first();
    const href = a.attr('href') || '';
    if (!href) return;
    const title = a.text().replace(/\s+/g, ' ').trim();
    if (!title) return;
    // Dekode URL redirect DDG (//duckduckgo.com/l/?uddg=<encoded>)
    let url = href;
    const m = href.match(/uddg=([^&]+)/);
    if (m) {
      try { url = decodeURIComponent(m[1]); } catch { /* pakai href apa adanya */ }
    }
    if (seen.has(url)) return;
    seen.add(url);
    const snippet = el.find('a.result__snippet').first().text().replace(/\s+/g, ' ').trim() || null;
    results.push({ title, url, snippet });
  });
  return results;
}

/**
 * Cari via DuckDuckGo.
 * @param {string} query - kata kunci
 * @param {object} [opts]
 * @param {number} [opts.limit=10] - ambil maks sejumlah ini hasil (1-20)
 * @param {function} [opts.onRetry] - callback ({attempt}) tiap percobaan
 * @returns {Promise<{source:string, query:string, limit:number, result_count:number, results:Array}>}
 */
export async function searchDuckDuckGo(query, opts = {}) {
  if (!query || typeof query !== 'string' || !query.trim()) {
    throw new Error("Parameter 'q' wajib diisi.");
  }
  const limit = Math.min(Math.max(parseInt(opts.limit) || 10, 1), 20);

  let lastErr;
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      opts.onRetry?.({ attempt });

      // 1) Coba lewat vqd + d.js (pola utama)
      try {
        const vqd = await getVqd(query);
        if (vqd) {
          const params = new URLSearchParams({ q: query, kl: 'us-en', l: 'us-en', s: '0', vqd, o: 'json', sp: '0' });
          const data = await fetchText(`${LINKS_API}?${params.toString()}`, { json: true });
          const results = parseJsonResults(data).slice(0, limit);
          if (results.length) {
            return {
              source: 'links.duckduckgo.com',
              query: query.trim(),
              limit,
              result_count: results.length,
              results,
            };
          }
        }
      } catch { /* lanjut fallback */ }

      // 2) Fallback: endpoint HTML klasik
      const params = new URLSearchParams({ q: query });
      const html = await fetchText(`${HTML_EP}?${params.toString()}`);
      const results = parseHtmlResults(html).slice(0, limit);
      if (results.length) {
        return {
          source: 'html.duckduckgo.com',
          query: query.trim(),
          limit,
          result_count: results.length,
          results,
        };
      }
      throw new Error('DuckDuckGo tidak mengembalikan hasil (kemungkinan terblokir)');
    } catch (e) {
      lastErr = e;
      if (attempt < 5) await delay(500 * Math.pow(2, attempt - 1));
    }
  }
  throw lastErr || new Error('Gagal mencari di DuckDuckGo');
}
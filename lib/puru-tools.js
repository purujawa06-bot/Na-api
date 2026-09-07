/**
 * Puru AI Tools — definisi + eksekutor tool.
 *
 * Dipakai oleh:
 *  - /api/tools/execute  (client-side agentic loop memanggil tool di sini)
 *  - (opsional) /api/puru-ai  (server-side loop legacy)
 *
 * Tool yang tersedia:
 *  - search_web    : pencarian Bing (tanpa API key)
 *  - crawl_web     : ambil & ekstrak teks dari URL
 *  - search_docs   : cari endpoint di dokumentasi PuruBoy API
 *  - endpoint_info : info lengkap satu endpoint (/api/...)
 *  - fetch         : HTTP request method apapun (GET/POST/PUT/DELETE)
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { searchBing } from './bing-search.js';

// ──────────────────── Docs Cache ────────────────────

let _docsCache = null;
let _docsCacheTime = 0;

export async function loadDocs() {
  if (_docsCache && Date.now() - _docsCacheTime < 60_000) return _docsCache;
  try {
    const raw = await readFile(join(process.cwd(), 'public', 'docs.json'), 'utf-8');
    _docsCache = JSON.parse(raw);
    _docsCacheTime = Date.now();
  } catch {
    _docsCache = _docsCache || {};
  }
  return _docsCache;
}

// ──────────────────── Tool Definitions ────────────────────

export function getToolDefinitions(docs) {
  const categories = Object.keys(docs).map((c) => `- ${c} (${docs[c].length} endpoints)`).join('\n');
  const catDetails = Object.entries(docs)
    .map(([cat, eps]) => {
      const list = eps.map((e) => `  • ${e.method} ${e.path} — ${e.title || ''}`).join('\n');
      return `[${cat}]\n${list}`;
    })
    .join('\n\n');

  return {
    tools: [
      {
        type: 'function',
        function: {
          name: 'search_web',
          description: 'Cari informasi di internet via Bing. Gunakan untuk pertanyaan umum, berita, fakta terkini, atau topik yang tidak terkait PuruBoy API.',
          parameters: {
            type: 'object',
            properties: {
              query: { type: 'string', description: 'Kata kunci pencarian' },
              limit: { type: 'number', description: 'Jumlah hasil (default 5, maks 10)' },
            },
            required: ['query'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'crawl_web',
          description: 'Ambil dan ekstrak teks dari sebuah URL. Berguna untuk membaca artikel, dokumentasi, atau halaman web tertentu.',
          parameters: {
            type: 'object',
            properties: {
              url: { type: 'string', description: 'URL halaman web yang ingin dibaca' },
              maxChars: { type: 'number', description: 'Maks karakter yang diambil (default 8000)' },
            },
            required: ['url'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'search_docs',
          description: `Cari endpoint di dokumentasi PuruBoy API. Gunakan untuk pertanyaan tentang cara pakai API ini. Kategori tersedia:\n${categories}\n\nDaftar endpoint:\n${catDetails}\n\nCari berdasarkan kata kunci (judul, path, atau deskripsi).`,
          parameters: {
            type: 'object',
            properties: {
              query: { type: 'string', description: 'Kata kunci pencarian (judul, path, atau deskripsi endpoint)' },
            },
            required: ['query'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'endpoint_info',
          description: 'Ambil informasi lengkap satu endpoint: method, path, params, example. Path harus diawali /api/',
          parameters: {
            type: 'object',
            properties: {
              path: { type: 'string', description: 'Path endpoint, contoh: /api/search/duckduckgo' },
            },
            required: ['path'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'fetch',
          description: 'Fetch URL apapun dengan method HTTP apapun. URL boleh absolut (https://example.com) atau relativ (/api/search/duckduckgo). Berguna untuk testing API endpoint atau mengambil data dari URL tertentu.',
          parameters: {
            type: 'object',
            properties: {
              url: { type: 'string', description: 'URL yang akan di-fetch (absolut atau relativ)' },
              method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'], description: 'HTTP method (GET, POST, PUT, DELETE, PATCH, HEAD, OPTIONS). Default GET.' },
              headers: { type: 'object', description: 'HTTP headers (opsional)' },
              body: { description: 'Request body untuk POST/PUT (opsional, string atau object)' },
            },
            required: ['url'],
          },
        },
      },
    ],
    docsMeta: {
      categories: Object.keys(docs),
      totalEndpoints: Object.values(docs).flat().length,
    },
  };
}

// ──────────────────── Tool Executors ────────────────────

/** Base URL untuk resolve relative paths (server-side execution). */
const SERVER_BASE = process.env.NEXT_PUBLIC_BASE_URL || 'https://puruboy-api.vercel.app';

/** Cegah SSRF: blokir akses ke host internal/lokal/metadata cloud. */
export function assertSafeUrl(url) {
  // Handle non-string input (undefined, number, object, etc.)
  if (!url || typeof url !== 'string') {
    throw new Error('URL tidak valid: parameter url wajib berupa string non-kosong');
  }
  let u;
  try {
    u = new URL(url);
  } catch {
    // Jika URL relativ (e.g. "/api/search/duckduckgo"), resolve terhadap base URL server
    try {
      u = new URL(url, SERVER_BASE);
    } catch {
      throw new Error(`URL tidak valid: "${url.slice(0, 80)}" bukan URL yang benar`);
    }
  }
  const host = u.hostname.toLowerCase();
  const blocked =
    host === 'localhost' ||
    host === '0.0.0.0' ||
    host === '127.0.0.1' ||
    host === '::1' ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host === '169.254.169.254' || // AWS metadata
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host);
  if (blocked) throw new Error('URL internal/local dilarang');
  return u;
}

async function executeSearchWeb({ query, limit = 5 }) {
  const r = await searchBing(query, { limit: Math.min(limit || 5, 10) });
  return JSON.stringify(
    r.results.map((item) => ({ title: item.title, url: item.url, snippet: item.snippet })),
    null,
    2,
  );
}

async function executeCrawlWeb({ url, maxChars = 8000 }) {
  const safeUrl = assertSafeUrl(url).toString();
  const res = await fetch(safeUrl, {
    headers: {
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
    signal: AbortSignal.timeout(15000),
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();
  // Strip tags, collapse whitespace
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const truncated = text.slice(0, maxChars);
  return JSON.stringify({ url: safeUrl, length: truncated.length, content: truncated });
}

async function executeSearchDocs({ query }, docs) {
  const q = String(query || '').toLowerCase();
  const results = [];
  for (const [category, endpoints] of Object.entries(docs)) {
    for (const ep of endpoints) {
      const haystack = `${ep.title || ''} ${ep.summary || ''} ${ep.path || ''} ${ep.description || ''}`.toLowerCase();
      if (haystack.includes(q)) {
        results.push({
          category,
          method: ep.method,
          path: ep.path,
          title: ep.title || '',
          summary: ep.summary || '',
          params: (ep.params || []).map((p) => ({
            name: p.name,
            type: p.type,
            required: p.required,
            description: p.description,
          })),
        });
      }
    }
  }
  if (results.length === 0) {
    // Fallback: search word by word
    const words = q.split(/\s+/).filter(Boolean);
    for (const [category, endpoints] of Object.entries(docs)) {
      for (const ep of endpoints) {
        const haystack = `${ep.title || ''} ${ep.summary || ''} ${ep.path || ''} ${ep.description || ''}`.toLowerCase();
        if (words.some((w) => haystack.includes(w))) {
          results.push({
            category,
            method: ep.method,
            path: ep.path,
            title: ep.title || '',
            summary: ep.summary || '',
          });
        }
      }
    }
  }
  return JSON.stringify(results.slice(0, 10), null, 2);
}

async function executeEndpointInfo({ path }, docs) {
  const normalizedPath = String(path || '').startsWith('/api/') ? path : `/api/${path}`;
  for (const [, endpoints] of Object.entries(docs)) {
    for (const ep of endpoints) {
      if (ep.path === normalizedPath) {
        return JSON.stringify(ep, null, 2);
      }
    }
  }
  return JSON.stringify({ error: `Endpoint "${normalizedPath}" tidak ditemukan` });
}

async function executeFetch({ url, method = 'GET', headers = {}, body }) {
  const safeUrl = assertSafeUrl(url).toString();
  const opts = { method: String(method || 'GET').toUpperCase(), headers: { 'user-agent': 'Mozilla/5.0', ...headers } };
  if (body && ['POST', 'PUT', 'PATCH'].includes(opts.method)) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = typeof body === 'string' ? body : JSON.stringify(body);
  }
  const res = await fetch(safeUrl, { ...opts, signal: AbortSignal.timeout(15000) });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text.slice(0, 5000);
  }
  return JSON.stringify({ status: res.status, data }, null, 2);
}

// ──────────────────── Dispatcher ────────────────────

export async function executeTool(toolName, args, docs) {
  switch (toolName) {
    case 'search_web': return await executeSearchWeb(args || {});
    case 'crawl_web': return await executeCrawlWeb(args || {});
    case 'search_docs': return await executeSearchDocs(args || {}, docs);
    case 'endpoint_info': return await executeEndpointInfo(args || {}, docs);
    case 'fetch': return await executeFetch(args || {});
    default: return JSON.stringify({ error: `Tool "${toolName}" tidak dikenal` });
  }
}
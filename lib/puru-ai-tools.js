/**
 * Puru AI — Tool Definitions
 *
 * Definisi tools dengan zod schemas untuk type-safety.
 * Konversi ke format OpenAI (function calling) via lightweight JSON Schema builder
 * (tanpa dependency zod-to-json-schema — menghindari peer dep conflict).
 *
 * Dipakai oleh:
 *  - Client (puru-ai/page.jsx): buildOpenAITools() → kirim ke /api/chat/completions
 */
import { z } from 'zod';

/* ═══════════════════════ Zod Schemas ═══════════════════════ */

export const searchWebSchema = z.object({
  query: z.string().describe('Kata kunci pencarian'),
  limit: z.number().optional().default(5).describe('Jumlah hasil (default 5, maks 10)'),
});

export const crawlWebSchema = z.object({
  url: z.string().describe('URL halaman web yang ingin dibaca'),
  maxChars: z.number().optional().default(8000).describe('Maks karakter yang diambil (default 8000)'),
});

export const searchDocsSchema = z.object({
  query: z.string().describe('Kata kunci pencarian (judul, path, atau deskripsi endpoint)'),
});

export const endpointInfoSchema = z.object({
  path: z.string().describe('Path endpoint, contoh: /api/search/duckduckgo'),
});

export const fetchSchema = z.object({
  url: z.string().describe('URL yang akan di-fetch'),
  method: z.enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS']).optional().default('GET').describe('HTTP method'),
  headers: z.record(z.string()).optional().describe('HTTP headers (opsional)'),
  body: z.union([z.string(), z.record(z.any())]).optional().describe('Request body untuk POST/PUT (opsional)'),
});

/* ═══════════════════════ Tool Registry ═══════════════════════ */

/**
 * Registry tools dengan metadata lengkap.
 * Setiap tool punya: schema (zod), label (tampilan), icon (FontAwesome),
 * jsonSchema (OpenAI function calling format).
 */
export const TOOL_REGISTRY = {
  search_web: {
    schema: searchWebSchema,
    label: 'Web Search',
    icon: 'fa-search',
    description: 'Cari informasi di internet via Bing. Gunakan untuk pertanyaan umum, berita, fakta terkini, atau topik yang tidak terkait PuruBoy API.',
    jsonSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Kata kunci pencarian' },
        limit: { type: 'number', description: 'Jumlah hasil (default 5, maks 10)', default: 5 },
      },
      required: ['query'],
    },
  },
  crawl_web: {
    schema: crawlWebSchema,
    label: 'Crawl Web',
    icon: 'fa-spider',
    description: 'Ambil dan ekstrak teks dari sebuah URL. Berguna untuk membaca artikel, dokumentasi, atau halaman web tertentu.',
    jsonSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL halaman web yang ingin dibaca' },
        maxChars: { type: 'number', description: 'Maks karakter yang diambil (default 8000)', default: 8000 },
      },
      required: ['url'],
    },
  },
  search_docs: {
    schema: searchDocsSchema,
    label: 'Search Docs',
    icon: 'fa-book',
    description: null, // dinamis, diisi oleh buildOpenAITools()
    jsonSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Kata kunci pencarian (judul, path, atau deskripsi endpoint)' },
      },
      required: ['query'],
    },
  },
  endpoint_info: {
    schema: endpointInfoSchema,
    label: 'Endpoint Info',
    icon: 'fa-circle-info',
    description: 'Ambil informasi lengkap satu endpoint: method, path, params, example. Path harus diawali /api/',
    jsonSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path endpoint, contoh: /api/search/duckduckgo' },
      },
      required: ['path'],
    },
  },
  fetch: {
    schema: fetchSchema,
    label: 'HTTP Fetch',
    icon: 'fa-plug',
    description: 'Fetch URL apapun dengan method HTTP apapun. Berguna untuk testing API endpoint atau mengambil data dari URL tertentu.',
    jsonSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL yang akan di-fetch' },
        method: {
          type: 'string',
          enum: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'],
          description: 'HTTP method',
          default: 'GET',
        },
        headers: {
          type: 'object',
          additionalProperties: { type: 'string' },
          description: 'HTTP headers (opsional)',
        },
        body: {
          description: 'Request body untuk POST/PUT (opsional)',
        },
      },
      required: ['url'],
    },
  },
};

/* ═══════════════════════ Build OpenAI Tools ═══════════════════════ */

/**
 * Bangun array definisi tools format OpenAI (function calling).
 * @param {string|null} docsSummary - Ringkasan docs.json untuk search_docs (opsional)
 * @returns {Array} Array tool definitions format OpenAI
 */
export function buildOpenAITools(docsSummary = null) {
  const categories = docsSummary
    ? docsSummary.split('\n\n').map((l) => l.replace(/^\[|\]$/g, '')).filter(Boolean)
    : [];

  const tools = [];

  for (const [name, def] of Object.entries(TOOL_REGISTRY)) {
    let desc = def.description;
    if (name === 'search_docs' && docsSummary) {
      desc = `Cari endpoint di dokumentasi PuruBoy API. Kategori tersedia: ${categories.join(', ')}.\n\nDaftar endpoint:\n${docsSummary}\n\nCari berdasarkan kata kunci (judul, path, atau deskripsi).`;
    } else if (name === 'search_docs' && !docsSummary) {
      desc = 'Cari endpoint di dokumentasi PuruBoy API. Cari berdasarkan kata kunci (judul, path, atau deskripsi endpoint).';
    }

    tools.push({
      type: 'function',
      function: {
        name,
        description: desc,
        parameters: def.jsonSchema,
      },
    });
  }

  return tools;
}

/**
 * Dapatkan metadata tool (icon, label) berdasarkan nama.
 * Dipakai oleh ToolCard untuk rendering UI.
 */
export function getToolMeta(name) {
  return TOOL_REGISTRY[name] || { icon: 'fa-wrench', label: name };
}

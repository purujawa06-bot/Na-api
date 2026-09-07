/**
 * Puru AI — Tool Definitions (Zod schemas)
 *
 * Definisi tools menggunakan zod untuk type-safety dan validasi.
 * Konversi otomatis ke format OpenAI (function calling) via zodToJsonSchema.
 *
 * Dipakai oleh:
 *  - Client (puru-ai/page.jsx): konversi ke OpenAI format → kirim ke /api/chat/completions
 *  - Bisa dipakai server-side untuk validasi input tool execution
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
 * Setiap tool punya: schema (zod), label (tampilan), icon (FontAwesome).
 */
export const TOOL_REGISTRY = {
  search_web: {
    schema: searchWebSchema,
    label: 'Web Search',
    icon: 'fa-search',
    description: 'Cari informasi di internet via Bing. Gunakan untuk pertanyaan umum, berita, fakta terkini, atau topik yang tidak terkait PuruBoy API.',
  },
  crawl_web: {
    schema: crawlWebSchema,
    label: 'Crawl Web',
    icon: 'fa-spider',
    description: 'Ambil dan ekstrak teks dari sebuah URL. Berguna untuk membaca artikel, dokumentasi, atau halaman web tertentu.',
  },
  search_docs: {
    schema: searchDocsSchema,
    label: 'Search Docs',
    icon: 'fa-book',
    description: null, // dinamis, diisi oleh buildToolsDefinition()
  },
  endpoint_info: {
    schema: endpointInfoSchema,
    label: 'Endpoint Info',
    icon: 'fa-circle-info',
    description: 'Ambil informasi lengkap satu endpoint: method, path, params, example. Path harus diawali /api/',
  },
  fetch: {
    schema: fetchSchema,
    label: 'HTTP Fetch',
    icon: 'fa-plug',
    description: 'Fetch URL apapun dengan method HTTP apapun. Berguna untuk testing API endpoint atau mengambil data dari URL tertentu.',
  },
};

/* ═══════════════════════ Zod → JSON Schema ═══════════════════════ */

/**
 * Konversi zod schema ke JSON Schema (OpenAI function calling format).
 * Menggunakan .toJsonSchema() yang built-in di zod v3.25+.
 */
function zodToJsonSchema(schema) {
  // zod v3.25+ punya .toJsonSchema() method
  if (typeof schema.toJsonSchema === 'function') {
    const result = schema.toJsonSchema();
    // Hasil zod toJsonSchema: { type, properties, required, ... }
    // Sudah kompatibel dengan OpenAI format
    return result;
  }
  // Fallback untuk zod versi lama — parse melalui shape
  const shape = schema.shape;
  const properties = {};
  const required = [];
  for (const [key, val] of Object.entries(shape)) {
    const isOptional = val._def?.typeName === 'ZodOptional';
    const inner = isOptional ? val._def.innerType : val;
    const typeName = inner._def?.typeName;
    const desc = inner.description || val.description || '';
    let jsonType = 'string';
    if (typeName === 'ZodNumber') jsonType = 'number';
    else if (typeName === 'ZodBoolean') jsonType = 'boolean';
    else if (typeName === 'ZodArray') jsonType = 'array';
    else if (typeName === 'ZodObject') jsonType = 'object';
    properties[key] = { type: jsonType, ...(desc ? { description: desc } : {}) };
    if (!isOptional) required.push(key);
  }
  return { type: 'object', properties, required };
}

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
    // search_docs description dinamis berdasarkan docsSummary
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
        parameters: zodToJsonSchema(def.schema),
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

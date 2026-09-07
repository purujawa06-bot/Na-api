/**
 * Puru AI — Tool Definitions
 *
 * Definisi tools dengan zod schemas sebagai SATU-SATUNYA sumber kebenaran (single source of truth).
 * JSON Schema untuk OpenAI function calling di-generate OTOMATIS dari zod schema
 * (tanpa dependency zod-to-json-schema — menghindari peer dep conflict).
 *
 * Dipakai oleh:
 *  - Client (puru-ai/page.jsx): buildOpenAITools() → kirim ke /api/chat/completions
 */
import { z } from 'zod';

/* ═══════════════════════ Zod → JSON Schema Converter ═══════════════════════ */

/**
 * Konversi zod schema → JSON Schema (format OpenAI function calling).
 * Mendukung tipe umum: string, number, boolean, enum, object, array, optional, default.
 * @param {z.ZodType} schema - Zod schema
 * @returns {object} JSON Schema
 */
function zodToJsonSchema(schema) {
  // unwrap ZodOptional / ZodDefault / ZodNullable keeping metadata
  if (schema._def?.typeName === 'ZodOptional' || schema._def?.typeName === 'ZodDefault') {
    return zodToJsonSchema(schema._def.innerType);
  }
  if (schema._def?.typeName === 'ZodNullable') {
    const inner = zodToJsonSchema(schema._def.innerType);
    return { ...inner, type: inner.type ? [inner.type, 'null'] : inner.type };
  }

  const description = schema._def?.description;

  switch (schema._def?.typeName) {
    case 'ZodString': {
      const out = { type: 'string' };
      if (description) out.description = description;
      return out;
    }
    case 'ZodNumber': {
      const out = { type: 'number' };
      if (description) out.description = description;
      return out;
    }
    case 'ZodBoolean': {
      const out = { type: 'boolean' };
      if (description) out.description = description;
      return out;
    }
    case 'ZodEnum': {
      const out = { type: 'string', enum: schema._def.values };
      if (description) out.description = description;
      return out;
    }
    case 'ZodNativeEnum': {
      const out = { type: 'string', enum: Object.values(schema._def.values) };
      if (description) out.description = description;
      return out;
    }
    case 'ZodRecord': {
      const out = {
        type: 'object',
        additionalProperties: zodToJsonSchema(schema._def.valueType),
      };
      if (description) out.description = description;
      return out;
    }
    case 'ZodArray': {
      const out = { type: 'array', items: zodToJsonSchema(schema._def.type) };
      if (description) out.description = description;
      return out;
    }
    case 'ZodObject': {
      const properties = {};
      const required = [];
      const shape = schema._def.shape();

      for (const [key, field] of Object.entries(shape)) {
        // field bisa ZodOptional/ZodDefault → unwrap untuk deteksi required
        const isRequired = !(
          field._def?.typeName === 'ZodOptional' || field._def?.typeName === 'ZodDefault'
        );
        properties[key] = zodToJsonSchema(field);
        if (isRequired) required.push(key);
      }

      const out = { type: 'object', properties };
      if (required.length) out.required = required;
      if (description) out.description = description;
      return out;
    }
    case 'ZodUnion': {
      const options = schema._def.options.map((o) => zodToJsonSchema(o));
      const out = { anyOf: options };
      if (description) out.description = description;
      return out;
    }
    default:
      // fallback: tipe tak dikenal (ZodAny, ZodLazy, dll) → longgar
      return description ? { description } : {};
  }
}

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
  url: z.string().describe('URL yang akan di-fetch (boleh absolut https://... atau relativ /api/...)'),
  method: z.enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS']).optional().default('GET').describe('HTTP method'),
  headers: z.record(z.string()).optional().describe('HTTP headers (opsional)'),
  body: z.union([z.string(), z.record(z.any())]).optional().describe('Request body untuk POST/PUT (opsional)'),
});

/* ═══════════════════════ Tool Registry ═══════════════════════ */

/**
 * Registry tools dengan metadata lengkap.
 * Setiap tool punya: schema (zod — SINGLE SOURCE OF TRUTH), label, icon.
 * jsonSchema di-generate otomatis dari schema via zodToJsonSchema().
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
    description: null, // dinamis, diisi oleh buildOpenAITools()
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

/* ═══════════════════════ Build OpenAI Tools ═══════════════════════ */

/**
 * Bangun array definisi tools format OpenAI (function calling).
 * jsonSchema di-generate otomatis dari zod schema.
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

/**
 * @title Puru AI — Agentic Chat
 * @summary Chat dengan AI yang bisa search web, crawl halaman, dan akses dokumentasi API.
 * @description Endpoint agentic chat yang menghubungkan AI dengan tools nyata:
 *              - search_web: pencarian Bing (tanpa API key)
 *              - crawl_web: ambil dan ekstrak konten dari URL
 *              - search_docs: cari endpoint di dokumentasi PuruBoy API
 *              - endpoint_info: ambil info lengkap satu endpoint
 *
 *              Server menjalankan agentic loop: AI memanggil tools → server eksekusi →
 *              hasil dikembalikan ke AI → loop sampai AI memberikan jawaban final.
 *              Response berupa stream JSON Lines (satu objek per baris).
 * @method POST
 * @path /api/puru-ai
 * @param {array} body.messages - Array pesan format OpenAI [{role: "user"|"assistant", content}]. Wajib.
 * @param {string} [body.model] - ID model AI (default "auto").
 * @response stream
 * @example
 * fetch('https://puruboy-api.vercel.app/api/puru-ai', {
 *     method: 'POST',
 *     headers: { 'Content-Type': 'application/json' },
 *     body: JSON.stringify({
 *         model: 'auto',
 *         messages: [{ role: 'user', content: 'Bagaimana cara pakai TikTok downloader?' }]
 *     })
 * }).then(res => {
 *     const reader = res.body.getReader();
 *     const dec = new TextDecoder();
 *     (async () => {
 *         let buf = '';
 *         while (true) {
 *             const { done, value } = await reader.read();
 *             if (done) break;
 *             buf += dec.decode(value);
 *             const lines = buf.split('\n');
 *             buf = lines.pop();
 *             for (const line of lines) {
 *                 if (!line.trim()) continue;
 *                 const obj = JSON.parse(line);
 *                 console.log(obj.type, obj.content || '');
 *             }
 *         }
 *     })();
 * });
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { searchBing } from '../../../lib/bing-search.js';
import { runAgenticStep } from '../chat/completions/route.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 120;

// ──────────────────── Load Docs ────────────────────

let _docsCache = null;
let _docsCacheTime = 0;

async function loadDocs() {
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

function getToolDefinitions(docs) {
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
          description: 'Fetch URL apapun dengan method HTTP apapun. Berguna untuk testing API endpoint atau mengambil data dari URL tertentu.',
          parameters: {
            type: 'object',
            properties: {
              url: { type: 'string', description: 'URL yang akan di-fetch' },
              method: { type: 'string', description: 'HTTP method (GET, POST, PUT, DELETE). Default GET.' },
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

async function executeSearchWeb({ query, limit = 5 }) {
  const r = await searchBing(query, { limit: Math.min(limit || 5, 10) });
  return JSON.stringify(
    r.results.map((item) => ({ title: item.title, url: item.url, snippet: item.snippet })),
    null,
    2,
  );
}

async function executeCrawlWeb({ url, maxChars = 8000 }) {
  const res = await fetch(url, {
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
  return JSON.stringify({ url, length: truncated.length, content: truncated });
}

async function executeSearchDocs({ query }, docs) {
  const q = query.toLowerCase();
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
  const normalizedPath = path.startsWith('/api/') ? path : `/api/${path}`;
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
  const opts = { method: method.toUpperCase(), headers: { 'user-agent': 'Mozilla/5.0', ...headers } };
  if (body && ['POST', 'PUT', 'PATCH'].includes(opts.method)) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = typeof body === 'string' ? body : JSON.stringify(body);
  }
  const res = await fetch(url, { ...opts, signal: AbortSignal.timeout(15000) });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text.slice(0, 5000);
  }
  return JSON.stringify({ status: res.status, data }, null, 2);
}

async function executeTool(toolName, args, docs) {
  switch (toolName) {
    case 'search_web': return await executeSearchWeb(args);
    case 'crawl_web': return await executeCrawlWeb(args);
    case 'search_docs': return await executeSearchDocs(args, docs);
    case 'endpoint_info': return await executeEndpointInfo(args, docs);
    case 'fetch': return await executeFetch(args);
    default: return JSON.stringify({ error: `Tool "${toolName}" tidak dikenal` });
  }
}

// ──────────────────── Agentic Loop ────────────────────

async function agenticLoop(userMessages, { model = 'auto', maxSteps = 8 } = {}) {
  const docs = await loadDocs();
  const { tools, docsMeta } = getToolDefinitions(docs);

  const systemMessage = {
    role: 'system',
    content: `You are Puru AI — an intelligent assistant built on the PuruBoy API platform.

You have access to tools that let you search the web, crawl web pages, and query the PuruBoy API documentation.

## Capabilities
- **search_web**: Search the internet via Bing for general knowledge, news, facts
- **crawl_web**: Fetch and read content from any URL
- **search_docs**: Search through PuruBoy API documentation (${docsMeta.totalEndpoints} endpoints in ${docsMeta.categories.length} categories: ${docsMeta.categories.join(', ')})
- **endpoint_info**: Get detailed info about a specific API endpoint (path must start with /api/)
- **fetch**: Make HTTP requests to any URL (useful for testing APIs)

## Guidelines
- For questions about PuruBoy API, always search docs first using search_docs or endpoint_info
- For general knowledge questions, use search_web
- If a user asks about a specific API endpoint, use endpoint_info to get the full specification
- When showing API examples, include the full fetch() code
- Answer in the language the user uses (Indonesian/English)
- Be concise but thorough
- Use markdown formatting for readability (code blocks, lists, bold, etc.)
- If a tool fails, explain the error and try an alternative approach
- You can call multiple tools in sequence to gather all needed information`,
  };

  const messages = [systemMessage, ...userMessages];
  const allToolCalls = [];
  let stepsLeft = maxSteps;

  while (stepsLeft-- > 0) {
    const { message: msg, model: usedModel } = await runAgenticStep({ model, messages, tools });

    // If no tool calls, return final text
    if (!msg.tool_calls || msg.tool_calls.length === 0) {
      return {
        type: 'final',
        text: msg.content || '',
        reasoning: msg.reasoning_content || null,
        model: usedModel,
        toolCalls: allToolCalls,
        finishReason: 'stop',
      };
    }

    // Has tool calls → execute them
    messages.push({
      role: 'assistant',
      content: msg.content || null,
      tool_calls: msg.tool_calls.map((tc) => ({
        id: tc.id,
        type: 'function',
        function: { name: tc.function.name, arguments: tc.function.arguments },
      })),
    });

    for (const tc of msg.tool_calls) {
      const name = tc.function.name;
      let args;
      try {
        args = JSON.parse(tc.function.arguments || '{}');
      } catch {
        args = {};
      }

      allToolCalls.push({ id: tc.id, name, args });

      let result;
      try {
        result = await executeTool(name, args, docs);
      } catch (e) {
        result = JSON.stringify({ error: e.message });
      }

      allToolCalls[allToolCalls.length - 1].result = result;
      messages.push({
        role: 'tool',
        tool_call_id: tc.id,
        content: result,
      });
    }
  }

  // Max steps exceeded — get one final answer
  const { message: finalMsg, model: finalModel } = await runAgenticStep({ model, messages, tools });
  return {
    type: 'final',
    text: finalMsg?.content || 'Maaf, saya membutuhkan lebih banyak langkah untuk menjawab pertanyaan ini.',
    reasoning: finalMsg?.reasoning_content || null,
    model: finalModel,
    toolCalls: allToolCalls,
    finishReason: 'stop',
  };
}

// ──────────────────── Route Handler ────────────────────

export async function POST(req) {
  let body;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { messages, model = 'auto' } = body;
  if (!Array.isArray(messages) || !messages.length) {
    return Response.json({ error: 'messages required' }, { status: 400 });
  }

  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj) => {
        try {
          controller.enqueue(enc.encode(JSON.stringify(obj) + '\n'));
        } catch { /* closed */ }
      };

      try {
        const result = await agenticLoop(messages, { model });

        // Send reasoning if present
        if (result.reasoning) {
          send({ type: 'thinking', content: result.reasoning });
        }

        // Send tool calls for display
        if (result.toolCalls.length > 0) {
          send({ type: 'tools_done', tools: result.toolCalls });
        }

        // Send final text (streaming word-by-word for effect)
        const words = result.text.split(/(\s+)/);
        for (const word of words) {
          send({ type: 'text', content: word });
        }

        send({ type: 'done', model: result.model });
      } catch (err) {
        send({ type: 'error', message: err.message || 'Internal error' });
      }

      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
    },
  });
}

export async function GET() {
  return Response.json({
    endpoint: '/api/puru-ai',
    method: 'POST',
    body: {
      messages: '[{role: "user", content: "..."}]',
      model: 'auto (default)',
    },
    tools: ['search_web', 'crawl_web', 'search_docs', 'endpoint_info', 'fetch'],
    note: 'Agentic loop: AI memanggil tools → server eksekusi → hasil dikembalikan ke AI → loop sampai jawaban final.',
  });
}

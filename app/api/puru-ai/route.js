/**
 * @title Puru AI — Agentic Chat
 * @summary Chat dengan AI yang bisa search web, crawl halaman, dan akses dokumentasi API.
 * @description Endpoint agentic chat yang menghubungkan AI dengan tools nyata:
 *              - search_web: pencarian Bing (tanpa API key)
 *              - crawl_web: ambil dan ekstrak konten dari URL
 *              - search_docs: cari endpoint di dokumentasi PuruBoy API
 *              - endpoint_info: ambil info lengkap satu endpoint
 *
 *              Server menjalankan agentic loop native via ToolLoopAgent (ai SDK v7):
 *              potong history + pruneMessages sebelum turn agar konteks free,
 *              lalu turn dan looping terus-menerus sampai ToolLoopAgent berhenti,
 *              kemudian kirim jawaban akhir.
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
import { runPuruAgent } from '../../../lib/puru-agent.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

// ──────────────────── Route Handler ────────────────────

export async function POST(req) {
  let body;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { messages, model = 'auto', maxSteps = 8 } = body || {};
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
        const result = await runPuruAgent(messages, { model, maxSteps });

        // Send reasoning if present
        if (result.reasoning) {
          send({ type: 'thinking', content: result.reasoning });
        }

        // Send tool calls for display
        if (result.toolCalls.length > 0) {
          send({ type: 'tools', tools: result.toolCalls });
          // kompatibilitas: client lama membaca tools_done
          send({ type: 'tools_done', tools: result.toolCalls });
        }

        // Send final text (streaming word-by-word for effect)
        const words = String(result.text || '').split(/(\s+)/);
        for (const word of words) {
          send({ type: 'text', content: word });
        }

        send({ type: 'done', model: result.model, steps: result.steps });
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
    note: 'Agentic loop native via ToolLoopAgent: potong history + pruneMessages sebelum turn, loop sampai berhenti, kirim jawaban akhir.',
  });
}

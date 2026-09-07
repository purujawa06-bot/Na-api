/**
 * @title DuckDuckGo Search
 * @summary Cari di DuckDuckGo (html.duckduckgo.com) tanpa browser.
 * @description Mencari di mesin pencari DuckDuckGo tanpa API key. Memakai
 *              retry hingga 5x agar lolos challenge/rate-limit anti-bot, lalu
 *              mengembalikan judul, URL, dan snippet. Respons berupa streaming
 *              JSON (JSON Lines — satu objek per baris) dengan event
 *              'processing' tiap ~2 detik sebagai keep-alive saat pencarian
 *              berlangsung, diakhiri event 'done'.
 * @method GET
 * @path /api/search/duckduckgo
 * @param {string} query.q - Kata kunci pencarian (wajib).
 * @param {number} [query.limit] - Jumlah hasil maks (default 10, maks 20).
 * @response stream
 * @example
 * fetch('https://puruboy-api.vercel.app/api/search/duckduckgo?q=nodejs+tutorial&limit=5')
 *     .then(res => {
 *         const reader = res.body.getReader();
 *         const dec = new TextDecoder();
 *         let buf = '';
 *         (async () => {
 *             while (true) {
 *                 const { done, value } = await reader.read();
 *                 if (done) break;
 *                 buf += dec.decode(value);
 *                 const lines = buf.split('\n');
 *                 buf = lines.pop();
 *                 for (const line of lines) {
 *                     if (!line.trim()) continue;
 *                     console.log(JSON.parse(line));
 *                 }
 *             }
 *         })();
 *     });
 */
import { searchDuckDuckGo } from '../../../../lib/duckduckgo-search.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

const KEEPALIVE_MS = 2000;

function parseQuery(searchParams) {
  const q = searchParams.get('q');
  if (!q || typeof q !== 'string' || !q.trim()) {
    return { error: { success: false, error: 'Parameter q wajib diisi' }, status: 400 };
  }
  if (q.length > 200) {
    return { error: { success: false, error: 'Query terlalu panjang (maks 200 karakter)' }, status: 400 };
  }
  const limit = Number(searchParams.get('limit')) || 10;
  return { params: { q: q.trim(), limit } };
}

function stream(emit, task) {
  const enc = new TextEncoder();
  const read = new ReadableStream({
    async start(controller) {
      const send = (obj) => controller.enqueue(enc.encode(JSON.stringify(obj) + '\n'));

      let last = Date.now();
      const heartbeat = setInterval(() => {
        if (Date.now() - last >= KEEPALIVE_MS) {
          last = Date.now();
          send({ event: 'processing', status: 'running' });
        }
      }, KEEPALIVE_MS);

      try {
        const result = await task((o) => send({ event: 'processing', ...o }));
        send({ event: 'done', success: true, status: 'success', ...result });
      } catch (err) {
        const status = err?.status === 400 ? 400 : 502;
        send({ event: 'done', success: false, status: 'error', error: err.message, httpStatus: status });
      } finally {
        clearInterval(heartbeat);
        controller.close();
      }
    },
  });

  return new Response(read, {
    headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-cache', Connection: 'keep-alive' },
  });
}

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const parsed = parseQuery(searchParams);
  if (parsed.error) {
    return Response.json(parsed.error, { status: parsed.status });
  }
  const { params } = parsed;
  return stream((o) => {}, (emit) =>
    searchDuckDuckGo(params.q, {
      limit: params.limit,
      onRetry: ({ attempt }) => emit({ attempt, progress: true }),
    })
  );
}

export async function POST(req) {
  let body;
  try {
    body = await req.json();
  } catch {
    return Response.json({ success: false, error: 'Body harus JSON: {"q": "..."}' }, { status: 400 });
  }
  const sp = new URLSearchParams();
  if (body?.q) sp.set('q', body.q);
  if (body?.limit != null) sp.set('limit', String(body.limit));
  const parsed = parseQuery(sp);
  if (parsed.error) {
    return Response.json(parsed.error, { status: parsed.status });
  }
  const { params } = parsed;
  return stream((o) => {}, (emit) =>
    searchDuckDuckGo(params.q, {
      limit: params.limit,
      onRetry: ({ attempt }) => emit({ attempt, progress: true }),
    })
  );
}

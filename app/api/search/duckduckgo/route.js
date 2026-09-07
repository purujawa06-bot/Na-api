/**
 * @title Web Search (Bing)
 * @summary Cari di Bing tanpa API key.
 * @description Mencari di mesin pencari Bing tanpa API key. Menggunakan
 *              scraping HTML Bing yang reliable dari serverless/Vercel.
 *              Retry 3x dengan backoff eksponensial jika terkena rate-limit.
 *              Respons berupa streaming JSON (JSON Lines) dengan event
 *              'processing' sebagai keep-alive, diakhiri event 'done'.
 * @method GET
 * @path /api/search/duckduckgo
 * @param {string} query.q - Kata kunci pencarian (wajib).
 * @param {number} [query.limit] - Jumlah hasil maks (default 10, maks 20).
 * @response stream
 * @example
 * fetch('https://nexta-api.vercel.app/api/search/duckduckgo?q=nodejs+tutorial&limit=5')
 */
import { searchBing } from '../../../../lib/bing-search.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

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

function stream(task) {
  const enc = new TextEncoder();
  const read = new ReadableStream({
    async start(controller) {
      const send = (obj) => controller.enqueue(enc.encode('data: ' + JSON.stringify(obj) + '\n\n'));

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
    headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', Connection: 'keep-alive' },
  });
}

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const parsed = parseQuery(searchParams);
  if (parsed.error) {
    return Response.json(parsed.error, { status: parsed.status });
  }
  const { params } = parsed;
  return stream((emit) =>
    searchBing(params.q, {
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
  return stream((emit) =>
    searchBing(params.q, {
      limit: params.limit,
      onRetry: ({ attempt }) => emit({ attempt, progress: true }),
    })
  );
}

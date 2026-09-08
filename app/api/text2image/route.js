/**
 * @title AI Text-to-Image (Vheer) — SSE Stream
 * @summary Generate gambar dari teks via vheer.com, result di-stream via SSE.
 * @description POST /api/text2image mengembalikan text/event-stream (SSE).
 *              Client menerima event_progress (status steps) lalu event_done
 *              atau event_error di akhir.
 *
 *              Dengan `export const maxDuration`, timeout Vercel bisa diatur
 *              lebih dari 60s (tergantung plan: Pro max 300s, Enterprise max 900s).
 *
 * @method POST
 * @path /api/text2image
 * @param {string} body.prompt - Deskripsi gambar (wajib).
 * @param {string} [body.size] - Rasio aspek (1:1, 16:9, 9:16, auto). Default: '1:1'.
 * @param {number} [body.num_images] - Jumlah gambar (1–4). Default: 1.
 * @response SSE stream
 * @example
 * const res = await fetch('/api/text2image', {
 *   method: 'POST',
 *   headers: { 'Content-Type': 'application/json' },
 *   body: JSON.stringify({ prompt: 'fox in snowy forest', size: '1:1', num_images: 1 })
 * });
 * const reader = res.body.getReader();
 * const decoder = new TextDecoder();
 * while (true) {
 *   const { done, value } = await reader.read();
 *   if (done) break;
 *   console.log(decoder.decode(value));
 * }
 */
import { textToImage } from '../../../lib/vheer-text2image.js';
import { reportError } from '../../../lib/errorLogger';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 120;

const SIZES = ['1:1', '16:9', '9:16', 'auto'];

export async function POST(req) {
  let body;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ success: false, error: 'Body JSON tidak valid' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
  if (!prompt) {
    return new Response(JSON.stringify({ success: false, error: 'Parameter prompt wajib diisi' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let size = typeof body.size === 'string' ? body.size.trim() : '1:1';
  if (!SIZES.includes(size)) {
    return new Response(
      JSON.stringify({ success: false, error: 'Parameter size tidak valid. Pilihan: 1:1, 16:9, 9:16, auto' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  let numImages = body.num_images;
  if (numImages !== undefined) numImages = Number(numImages);
  if (!Number.isFinite(numImages) || numImages < 1) numImages = 1;
  if (numImages > 4) numImages = 4;

  // SSE stream
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event, data) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };

      try {
        const result = await textToImage({
          prompt,
          aspectRatio: size,
          numImages,
          maxWaitMs: 115000, // slightly under 120s maxDuration
          onProgress: (event, data) => {
            send('progress', { event, ...data });
          },
        });

        send('done', {
          success: true,
          source: 'vheer',
          model: result.model,
          taskId: result.taskId,
          images: result.images,
        });
      } catch (err) {
        reportError(err, { endpoint: '/api/text2image', method: 'POST' }).catch(() => {});
        send('error', {
          success: false,
          error: err.message || 'Gagal generate gambar',
          status: err.status || 500,
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}

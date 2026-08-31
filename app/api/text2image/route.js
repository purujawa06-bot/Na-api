/**
 * @title AI Text-to-Image (Vheer)
 * @summary Generate gambar dari teks (model gratis Flux), tanpa login.
 * @description Membuat gambar dari prompt teks via layanan vheer.com
 *              (reverse-engineered, pure-HTTP). Bekerja anonim dengan model
 *              gratis `flux_dev`. Menjalankan moderasi konten otomatis.
 *              Dukungan streaming SSE untuk progress real-time.
 * @method POST
 * @path /api/text2image
 * @param {string} body.prompt - Deskripsi gambar yang ingin dibuat (wajib).
 * @param {string} [body.model] - Model gambar.
 *        @choice flux_dev - Flux Dev (Gratis, Recommended)
 *        @choice flux_klein - Flux Klein (butuh kredit akun)
 *        @choice gpt_image_2 - GPT Image 2 (butuh kredit akun)
 *        @choice nano_banana_pro - Nano Banana Pro (butuh kredit akun)
 *        @choice nano_banana_2 - Nano Banana 2 (butuh kredit akun)
 *        @choice bytedance_seedream_v4/text-to-image - Seedream V4 (butuh kredit akun)
 *        @choice bytedance_seedream_v4.5/text-to-image - Seedream V4.5 (butuh kredit akun)
 *        @choice bytedance_seedream_v5/text-to-image - Seedream V5 (butuh kredit akun)
 *        @choice minimax_image_01 - MiniMax Image 01 (butuh kredit akun)
 * @param {string} [body.size] - Rasio aspek gambar.
 *        @choice 1:1 - Persegi (Default)
 *        @choice 16:9 - Landscape
 *        @choice 9:16 - Portrait
 *        @choice auto - Menyesuaikan prompt
 * @param {number} [body.num_images] - Jumlah gambar (default 1).
 * @param {boolean} [body.stream] - Streaming SSE progress.
 *        @choice true - Ya (Streaming)
 *        @choice false - Tidak (JSON Default)
 * @response json
 * @example Buat gambar (JSON)
 * fetch('https://puruboy-api.vercel.app/api/text2image', {
 *     method: 'POST',
 *     headers: { 'Content-Type': 'application/json' },
 *     body: JSON.stringify({
 *         prompt: 'seekor rubah merah di hutan salju',
 *         model: 'flux_dev',
 *         size: '1:1',
 *         num_images: 1,
 *         stream: false
 *     })
 * }).then(res => res.json()).then(console.log);
 *
 * @example Streaming progress (SSE)
 * fetch('https://puruboy-api.vercel.app/api/text2image', {
 *     method: 'POST',
 *     headers: { 'Content-Type': 'application/json' },
 *     body: JSON.stringify({
 *         prompt: 'kucing oren berkaca mata hitam',
 *         model: 'flux_dev',
 *         size: '1:1',
 *         num_images: 1,
 *         stream: true
 *     })
 * }).then(res => {
 *     const reader = res.body.getReader();
 *     const dec = new TextDecoder();
 *     (async () => {
 *         while (true) {
 *             const { done, value } = await reader.read();
 *             if (done) break;
 *             console.log(dec.decode(value));
 *         }
 *     })();
 * });
 */
import { NextResponse } from 'next/server';
import { textToImage } from '../../../lib/vheer-text2image.js';
import { reportError } from '../../../lib/errorLogger';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 180;

const MODEL_CREDITS = {
  flux_dev: 0,
  flux_klein: 4,
  gpt_image_2: 25,
  nano_banana_pro: 30,
  nano_banana_2: 16,
  'bytedance_seedream_v4/text-to-image': 6,
  'bytedance_seedream_v4.5/text-to-image': 6,
  'bytedance_seedream_v5/text-to-image': 6,
  minimax_image_01: 8,
};

const SIZES = ['1:1', '16:9', '9:16', 'auto'];

function sse(event, data) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function POST(req) {
  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Body JSON tidak valid' }, { status: 400 });
  }

  const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
  if (!prompt) {
    return NextResponse.json({ success: false, error: 'Parameter prompt wajib diisi' }, { status: 400 });
  }

  let model = typeof body.model === 'string' ? body.model.trim() : 'flux_dev';
  if (MODEL_CREDITS[model] === undefined) {
    return NextResponse.json({ success: false, error: `Model tidak dikenal: ${model}` }, { status: 400 });
  }
  if (MODEL_CREDITS[model] > 0) {
    return NextResponse.json(
      { success: false, error: `Model ${model} butuh kredit akun vheer. Gunakan model gratis: flux_dev` },
      { status: 400 }
    );
  }

  let size = typeof body.size === 'string' ? body.size.trim() : '1:1';
  if (!SIZES.includes(size)) {
    return NextResponse.json({ success: false, error: 'Parameter size tidak valid. Pilihan: 1:1, 16:9, 9:16, auto' }, { status: 400 });
  }

  let numImages = body.num_images;
  if (numImages !== undefined) numImages = Number(numImages);
  if (Number.isFinite(numImages) && numImages < 1) numImages = 1;
  if (!Number.isFinite(numImages) || numImages > 4) numImages = 1;

  let stream = body.stream;
  if (typeof stream === 'string') stream = stream.trim() === 'true';

  const opts = { prompt, model, aspectRatio: size, numImages };

  if (stream) {
    const enc = new TextEncoder();
    const read = new ReadableStream({
      async start(controller) {
        const send = (evt, data) => controller.enqueue(enc.encode(sse(evt, data)));
        try {
          send('message', { event: 'moderation', message: 'Memeriksa prompt...' });
          const result = await textToImage({
            ...opts,
            onProgress: (evt, data) => send('message', { event: evt, ...data }),
          });
          send('done', { success: true, images: result.images, model: result.model, taskId: result.taskId });
        } catch (err) {
          send('error', { success: false, error: err.message });
        } finally {
          controller.close();
        }
      },
    });
    return new Response(read, {
      headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' },
    });
  }

  try {
    const result = await textToImage(opts);
    return NextResponse.json({
      success: true,
      source: 'vheer',
      model: result.model,
      taskId: result.taskId,
      images: result.images,
    });
  } catch (error) {
    if (error?.status === 400) return NextResponse.json({ success: false, error: error.message }, { status: 400 });
    if (error?.status === 504) return NextResponse.json({ success: false, error: error.message }, { status: 504 });
    reportError(error, { endpoint: '/api/text2image' }).catch(() => {});
    return NextResponse.json({ success: false, error: error.message }, { status: 502 });
  }
}

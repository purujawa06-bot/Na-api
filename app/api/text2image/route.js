/**
 * @title AI Text-to-Image (Vheer)
 * @summary Generate gambar dari teks (model gratis Flux), tanpa login.
 * @description Membuat gambar dari prompt teks via layanan vheer.com
 *              (reverse-engineered, pure-HTTP). Hanya menyediakan model
 *              gratis `flux_dev` (tanpa perlu akun/kredit). Menjalankan
 *              moderasi konten otomatis. Respon berupa streaming JSON
 *              (JSON Lines — satu objek per baris) setiap 2 detik agar
 *              koneksi tetap hidup sampai gambar selesai.
 * @method POST
 * @path /api/text2image
 * @param {string} body.prompt - Deskripsi gambar yang ingin dibuat (wajib).
 * @param {string} [body.size] - Rasio aspek gambar.
 *        @choice 1:1 - Persegi (Default)
 *        @choice 16:9 - Landscape
 *        @choice 9:16 - Portrait
 *        @choice auto - Menyesuaikan prompt
 * @param {number} [body.num_images] - Jumlah gambar (default 1, maks 4).
 * @response stream
 * @example Membuat gambar (streaming JSON)
 * fetch('https://puruboy-api.vercel.app/api/text2image', {
 *     method: 'POST',
 *     headers: { 'Content-Type': 'application/json' },
 *     body: JSON.stringify({
 *         prompt: 'seekor rubah merah di hutan salju',
 *         size: '1:1',
 *         num_images: 1
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
 *                 console.log(obj.event, obj.status || '', obj.images || '');
 *             }
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

const SIZES = ['1:1', '16:9', '9:16', 'auto'];

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

  let size = typeof body.size === 'string' ? body.size.trim() : '1:1';
  if (!SIZES.includes(size)) {
    return NextResponse.json({ success: false, error: 'Parameter size tidak valid. Pilihan: 1:1, 16:9, 9:16, auto' }, { status: 400 });
  }

  let numImages = body.num_images;
  if (numImages !== undefined) numImages = Number(numImages);
  if (!Number.isFinite(numImages) || numImages < 1) numImages = 1;
  if (numImages > 4) numImages = 4;

  const enc = new TextEncoder();
  const read = new ReadableStream({
    async start(controller) {
      const emit = (obj) => controller.enqueue(enc.encode(JSON.stringify(obj) + '\n'));

      try {
        emit({ event: 'moderation', status: 'running', message: 'Memeriksa prompt...' });

        const result = await textToImage({
          prompt,
          aspectRatio: size,
          numImages,
          onProgress: () => {
            // keep-alive: kirim progress tiap polling (2 detik di lib)
            emit({ event: 'processing', status: 'running' });
          },
        });

        emit({
          event: 'done',
          success: true,
          status: 'success',
          source: 'vheer',
          model: result.model,
          taskId: result.taskId,
          images: result.images,
        });
      } catch (err) {
        const status = err?.status === 400 ? 400 : err?.status === 504 ? 504 : 502;
        if (status === 502) reportError(err, { endpoint: '/api/text2image' }).catch(() => {});
        emit({ event: 'done', success: false, status: 'error', error: err.message, httpStatus: status });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(read, {
    headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-cache', Connection: 'keep-alive' },
  });
}

/**
 * @title Image Upscaler
 * @summary Perbesar (upscale) gambar AI hingga 2x-4x via iloveimg.com.
 * @description Menerima URL publik gambar, mengunduh, memperbesarnya, lalu
 *              mengupload hasilnya ke tmpfiles.org dan mengembalikan URL
 *              gambar langsung. Respon berupa streaming JSON (JSON Lines)
 *              dengan event `processing` setiap 2 detik hingga selesai.
 * @method POST
 * @path /api/tools-image/upscaler
 * @param {string} body.file - URL publik gambar (http/https; png/jpg/webp) (wajib).
 * @param {number} [body.scale] - Faktor skala (2, 3, atau 4). Default 2.
 * @response stream
 * @example
 * fetch('https://puruboy-api.vercel.app/api/tools-image/upscaler', {
 *     method: 'POST',
 *     headers: { 'Content-Type': 'application/json' },
 *     body: JSON.stringify({ file: 'https://puruboy-api.vercel.app/example.jpg', scale: 2 })
 * }).then(res => res.json()).then(console.log);
 */
import { NextResponse } from 'next/server';
import { upscaleImage } from '../../../../lib/iloveimg-upscaler.js';
import { reportError } from '../../../../lib/errorLogger';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 120;

const TMPFILES_UPLOAD = 'https://tmpfiles.org/api/v1/upload';

async function uploadTmpfiles(buffer, filename, mimetype) {
  const form = new FormData();
  form.append('file', new Blob([buffer], { type: mimetype }), filename);
  const res = await fetch(TMPFILES_UPLOAD, { method: 'POST', body: form });
  if (!res.ok) throw new Error(`Upload tmpfiles gagal (HTTP ${res.status})`);
  const { data } = await res.json();

  // data.url berisi halaman viewer HTML, bukan file mentah. Ambil URL gambar
  // langsung (img_preview) yang disuntikkan di halaman tersebut.
  const page = await fetch(data.url, { headers: { 'user-agent': 'Mozilla/5.0' } });
  if (page.ok) {
    const html = await page.text();
    const direct = (html.match(/src="(https:\/\/tmpfiles\.org\/dl\/[^"]+)"/) || [])[1];
    if (direct) return direct;
  }
  throw new Error('Gagal mengambil link gambar langsung dari tmpfiles');
}

export async function POST(req) {
  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Body JSON tidak valid' }, { status: 400 });
  }

  const url = typeof body.file === 'string' ? body.file.trim() : '';
  if (!url) {
    return NextResponse.json({ success: false, error: 'Parameter "file" (URL gambar) wajib diisi' }, { status: 400 });
  }

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return NextResponse.json({ success: false, error: 'URL file tidak valid' }, { status: 400 });
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return NextResponse.json({ success: false, error: 'URL harus http/https' }, { status: 400 });
  }

  let scale = parseInt(body.scale || 2, 10);
  if (![2, 3, 4].includes(scale)) scale = 2;

  const enc = new TextEncoder();
  const read = new ReadableStream({
    async start(controller) {
      const emit = (obj) => controller.enqueue(enc.encode(JSON.stringify(obj) + '\n'));
      const heartbeat = setInterval(() => emit({ event: 'processing', status: 'running' }), 2000);

      try {
        const { buffer, mimetype, filename } = await upscaleImage(url, scale);
        const dlName = `${filename.split('.')[0]}_${scale}x.png`;
        emit({ event: 'uploading', status: 'running', message: 'Mengunggah hasil ke tmpfiles.org...' });
        const resultUrl = await uploadTmpfiles(buffer, dlName, mimetype);

        emit({
          event: 'done',
          success: true,
          status: 'success',
          source: 'iloveimg',
          scale,
          url: resultUrl,
        });
      } catch (err) {
        reportError(err, { endpoint: '/api/tools-image/upscaler' }).catch(() => {});
        emit({ event: 'done', success: false, status: 'error', error: err.message, httpStatus: 502 });
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

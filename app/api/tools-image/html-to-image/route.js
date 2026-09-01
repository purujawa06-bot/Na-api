/**
 * @title HTML to Image
 * @summary Konversi halaman web/URL menjadi gambar (jpg/svg) via iloveimg.com.
 * @description Menerima URL publik halaman web, mengkonversinya menjadi gambar, lalu
 *              mengupload hasil ke tmpfiles.org dan mengembalikan URL gambar langsung.
 *              Respon berupa streaming JSON (JSON Lines) dengan event `processing`,
 *              `uploading` hingga selesai.
 * @method POST
 * @path /api/tools-image/html-to-image
 * @param {string} body.file - URL publik halaman web (http/https) yang ingin dijadikan gambar (wajib).
 * @param {number} [body.view_width] - Lebar render dalam pixel (default: 1920).
 * @param {string} [body.to_format] - Format output: jpg atau svg (default: jpg).
 * @response stream
 * @example
 * fetch('https://puruboy-api.vercel.app/api/tools-image/html-to-image', {
 *     method: 'POST',
 *     headers: { 'Content-Type': 'application/json' },
 *     body: JSON.stringify({ file: 'https://example.com', view_width: 1920, to_format: 'jpg' })
 * }).then(res => res.json()).then(console.log);
 */
import { NextResponse } from 'next/server';
import { htmlToImage } from '../../../../lib/iloveimg-html.js';
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
    return NextResponse.json({ success: false, error: 'Parameter "file" (URL halaman web) wajib diisi' }, { status: 400 });
  }

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return NextResponse.json({ success: false, error: 'URL tidak valid' }, { status: 400 });
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return NextResponse.json({ success: false, error: 'URL harus http/https' }, { status: 400 });
  }

  const viewWidth = body.view_width ? Number(body.view_width) : 1920;
  const toFormat = ['jpg', 'svg'].includes(body.to_format) ? body.to_format : 'jpg';

  const enc = new TextEncoder();
  const read = new ReadableStream({
    async start(controller) {
      const emit = (obj) => controller.enqueue(enc.encode(JSON.stringify(obj) + '\n'));
      const heartbeat = setInterval(() => emit({ event: 'processing', status: 'running' }), 2000);

      try {
        emit({ event: 'processing', status: 'running', message: 'Mengkonversi halaman web menjadi gambar...' });
        const { buffer, mimetype, filename } = await htmlToImage(url, { viewWidth, toFormat });
        emit({ event: 'uploading', status: 'running', message: 'Mengunggah hasil ke tmpfiles.org...' });
        const resultUrl = await uploadTmpfiles(buffer, filename, mimetype);

        emit({
          event: 'done',
          success: true,
          status: 'success',
          source: 'iloveimg',
          url: resultUrl,
          filename,
          mimetype,
        });
      } catch (err) {
        reportError(err, { endpoint: '/api/tools-image/html-to-image' }).catch(() => {});
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
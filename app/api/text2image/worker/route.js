/**
 * @title Text-to-Image Worker (internal)
 * @summary Endpoint internal yang menjalankan polling vheer sampai selesai.
 * @description JANGAN dipanggil publik. Hanya dipanggil oleh Background HTTP
 *              Job proxy (https://nirkyy-a.hf.space/) agar proses generasi
 *              gambar (bisa > 60 detik) tidak kena timeout serverless Vercel.
 *              Wajib menyertakan header `Authorization: Bearer <PURUBOY_ADMIN_KEY>`.
 * @method POST
 * @path /api/text2image/worker
 * @access internal (Bearer token)
 * @param {string} body.prompt - Deskripsi gambar (wajib).
 * @param {string} [body.size] - Rasio aspek (1:1, 16:9, 9:16, auto).
 * @param {number} [body.num_images] - Jumlah gambar (default 1, maks 4).
 * @example Internal (dipanggil proxy, jangan dipakai publik)
 * fetch('https://puruboy-api.vercel.app/api/text2image/worker', {
 *     method: 'POST',
 *     headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer <PURUBOY_ADMIN_KEY>' },
 *     body: JSON.stringify({ prompt: 'seekor rubah merah di hutan salju', size: '1:1', num_images: 1 })
 * }).then(res => res.json()).then(console.log);
 */
import { NextResponse } from 'next/server';
import { textToImage } from '../../../../lib/vheer-text2image.js';
import { reportError } from '../../../../lib/errorLogger';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

const WORKER_SECRET = process.env.PURUBOY_ADMIN_KEY || '';

export async function POST(req) {
  // Auth internal: header Authorization: Bearer <key>
  const auth = req.headers.get('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!WORKER_SECRET || token !== WORKER_SECRET) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

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

  const SIZES = ['1:1', '16:9', '9:16', 'auto'];
  let size = typeof body.size === 'string' ? body.size.trim() : '1:1';
  if (!SIZES.includes(size)) size = '1:1';

  let numImages = body.num_images;
  if (numImages !== undefined) numImages = Number(numImages);
  if (!Number.isFinite(numImages) || numImages < 1) numImages = 1;
  if (numImages > 4) numImages = 4;

  try {
    const result = await textToImage({
      prompt,
      aspectRatio: size,
      numImages,
      maxWaitMs: 240000, // worker boleh nunggu lebih lama (proxy tidak dibatasi 60s)
    });

    return NextResponse.json({
      success: true,
      status: 'success',
      source: 'vheer',
      model: result.model,
      taskId: result.taskId,
      images: result.images,
    });
  } catch (err) {
    const status = err?.status === 400 ? 400 : err?.status === 504 ? 504 : 502;
    reportError(err, { endpoint: '/api/text2image/worker', method: 'POST' }).catch(() => {});
    return NextResponse.json(
      { success: false, status: 'error', error: err.message, httpStatus: status },
      { status: status === 400 ? 400 : 502 }
    );
  }
}
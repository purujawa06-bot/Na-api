/**
 * @title Image Upscaler
 * @summary Perbesar (upscale) gambar AI hingga 2x-4x via iloveimg.com.
 * @description Menerima URL publik gambar lalu mengunduh dan memperbesarnya.
 *              Mengembalikan file gambar hasil upscale sebagai binary (image/png).
 * @method POST
 * @path /api/tools-image/upscaler
 * @param {string} body.file - URL publik gambar (http/https; png/jpg/webp) (wajib).
 * @param {number} [body.scale] - Faktor skala (2, 3, atau 4). Default 2.
 * @response binary
 * @example
 * fetch('https://puruboy-api.vercel.app/api/tools-image/upscaler', {
 *     method: 'POST',
 *     headers: { 'Content-Type': 'application/json' },
 *     body: JSON.stringify({
 *         file: 'https://puruboy-api.vercel.app/example.jpg',
 *         scale: 2
 *     })
 * }).then(res => res.blob()).then(console.log);
 */
import { NextResponse } from 'next/server';
import { upscaleImage } from '../../../../lib/iloveimg-upscaler.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

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

  try {
    const { buffer, mimetype, filename } = await upscaleImage(url, scale);
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': mimetype,
        'Content-Disposition': `inline; filename="${filename.split('.')[0]}_${scale}x.png"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 502 });
  }
}

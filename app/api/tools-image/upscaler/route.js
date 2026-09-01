/**
 * @title Image Upscaler
 * @summary Perbesar (upscale) gambar AI hingga 2x-4x via iloveimg.com.
 * @description Menerima upload file gambar (multipart/form-data) lalu
 *              memperbesarnya. Mengembalikan file gambar hasil upscale
 *              sebagai binary (image/png).
 * @method POST
 * @path /api/tools-image/upscaler
 * @param {file} body.file - Gambar yang akan diperbesar (wajib).
 * @param {string} [body.scale] - Faktor skala (2, 3, atau 4). Default 2.
 * @response binary
 * @example
 * const form = new FormData();
 * form.append('file', gambarFile);
 * form.append('scale', '2');
 * fetch('https://puruboy-api.vercel.app/api/tools-image/upscaler', { method: 'POST', body: form })
 *     .then(res => res.blob())
 *     .then(console.log);
 */
import { NextResponse } from 'next/server';
import { upscaleImage } from '../../../../lib/iloveimg-upscaler.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req) {
  let form;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ success: false, error: 'Request harus multipart/form-data' }, { status: 400 });
  }

  const file = form.get('file');
  if (!file || typeof file === 'string') {
    return NextResponse.json(
      { success: false, error: 'Field "file" (gambar) wajib diisi' },
      { status: 400 }
    );
  }

  let scale = parseInt(form.get('scale') || '2', 10);
  if (![2, 3, 4].includes(scale)) scale = 2;

  try {
    const { buffer, mimetype, filename } = await upscaleImage(file, scale);
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

/**
 * @title ImgBB Hosting
 * @summary Upload gambar gratis ke imgbb.com via file langsung.
 * @description Mengupload file gambar (multipart field `file`, maks 32 MB) ke
 *              imgbb.com tanpa API key (token diambil otomatis dari homepage).
 *              Respon berisi direct link (i.ibb.co), thumbnail, medium, viewer & delete URL.
 * @method POST
 * @path /api/uploader/imggbb
 * @param {file} formData.file - File gambar (jpeg/png/gif/webp/bmp/tiff/heic, maks 32 MB) (wajib).
 * @response json
 * @example
 * const fd = new FormData();
 * fd.append('file', fileInput.files[0]);
 * fetch('https://puruboy-api.vercel.app/api/uploader/imggbb', { method: 'POST', body: fd })
 *     .then(res => res.json())
 *     .then(console.log);
 */
import { NextResponse } from 'next/server';
import { uploadFile, MAX_FILE_SIZE } from '../../../../lib/imgbb.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

const ALLOWED_MIME = new Set([
  'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/bmp', 'image/tiff', 'image/heic',
]);

export async function POST(req) {
  let form;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ success: false, error: 'Form multipart tidak valid, gunakan field file' }, { status: 400 });
  }
  const file = form.get('file');
  if (!file || typeof file.arrayBuffer !== 'function' || file.size === 0) {
    return NextResponse.json({ success: false, error: 'Parameter file (gambar) wajib diisi' }, { status: 400 });
  }
  const mimetype = file.type || 'application/octet-stream';
  if (!mimetype.startsWith('image/') && !ALLOWED_MIME.has(mimetype)) {
    return NextResponse.json({ success: false, error: 'File harus berupa gambar (jpeg/png/gif/webp/bmp/tiff/heic)' }, { status: 400 });
  }
  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json({ success: false, error: 'File melebihi 32 MB (limit imgbb free)' }, { status: 400 });
  }
  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const result = await uploadFile(buffer, file.name || 'upload.jpg', mimetype);
    return NextResponse.json({ success: true, source: 'imgbb.com', ...result });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 502 });
  }
}

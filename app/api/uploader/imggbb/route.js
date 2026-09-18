/**
 * @title ImgBB Hosting
 * @summary Upload gambar gratis ke imgbb.com (via URL atau file langsung).
 * @description Mengupload gambar ke imgbb.com tanpa API key (token diambil otomatis
 *              dari homepage). Mendukung sumber URL publik (query/body `url`) atau
 *              file langsung (multipart field `file`, maks 32 MB). Respon berisi
 *              direct link (i.ibb.co), thumbnail, medium, viewer & delete URL.
 *              Opsional: expiration (auto-hapus), title, description.
 * @method GET
 * @path /api/uploader/imggbb
 * @param {string} query.url - URL publik gambar http/https (wajib bila tanpa file).
 * @param {string} [query.expiration] - Auto-hapus: PT5M, PT15M, PT30M, PT1H, PT3H, PT6H, PT12H, P1D-P6D, P1W-P3W, P1M-P6M.
 * @param {string} [query.title] - Judul gambar.
 * @param {string} [query.description] - Deskripsi gambar.
 * @method POST
 * @path /api/uploader/imggbb
 * @param {string} [body.url] - URL publik gambar (alternatif file).
 * @param {file} [body.file] - File gambar multipart (alternatif url, maks 32 MB).
 * @param {string} [body.expiration] - Auto-hapus (lihat daftar di GET).
 * @param {string} [body.title] - Judul gambar.
 * @param {string} [body.description] - Deskripsi gambar.
 * @response json
 * @example
 * fetch('https://puruboy-api.vercel.app/api/uploader/imggbb?url=https%3A%2F%2Fpicsum.photos%2Fseed%2Ftest123%2F400%2F300.jpg')
 *     .then(res => res.json())
 *     .then(console.log);
 */
import { NextResponse } from 'next/server';
import { uploadFromUrl, uploadFile, MAX_FILE_SIZE } from '../../../../lib/imgbb.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

function validateImageUrl(url) {
  if (!url || typeof url !== 'string') return { error: 'Parameter url wajib diisi', status: 400 };
  if (url.length > 2048) return { error: 'URL terlalu panjang', status: 400 };
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return { error: 'URL tidak valid', status: 400 };
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { error: 'URL harus http/https', status: 400 };
  }
  return null;
}

const ALLOWED_MIME = new Set([
  'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/bmp', 'image/tiff', 'image/heic',
]);

async function handleUrl(url, opts) {
  const invalid = validateImageUrl(url);
  if (invalid) return NextResponse.json({ success: false, error: invalid.error }, { status: invalid.status });
  try {
    const result = await uploadFromUrl(url, opts);
    return NextResponse.json({ success: true, source: 'imgbb.com', ...result });
  } catch (error) {
    const bad = typeof error.message === 'string' && error.message.startsWith('Expiration tidak valid');
    return NextResponse.json({ success: false, error: error.message }, { status: bad ? 400 : 502 });
  }
}

async function handleFile(file, opts) {
  if (!file || typeof file.arrayBuffer !== 'function') {
    return NextResponse.json({ success: false, error: 'Field file (multipart) wajib diisi atau gunakan url' }, { status: 400 });
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
    const result = await uploadFile(buffer, file.name || 'upload.jpg', mimetype, opts);
    return NextResponse.json({ success: true, source: 'imgbb.com', ...result });
  } catch (error) {
    const bad = typeof error.message === 'string' && error.message.startsWith('Expiration tidak valid');
    return NextResponse.json({ success: false, error: error.message }, { status: bad ? 400 : 502 });
  }
}

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  return handleUrl(searchParams.get('url'), {
    expiration: searchParams.get('expiration'),
    title: searchParams.get('title'),
    description: searchParams.get('description'),
  });
}

export async function POST(req) {
  const contentType = req.headers.get('content-type') || '';
  // Multipart (upload file langsung)
  if (contentType.includes('multipart/form-data')) {
    let form;
    try {
      form = await req.formData();
    } catch {
      return NextResponse.json({ success: false, error: 'Form multipart tidak valid' }, { status: 400 });
    }
    const file = form.get('file');
    const url = form.get('url');
    const opts = {
      expiration: form.get('expiration') ? String(form.get('expiration')) : null,
      title: form.get('title') ? String(form.get('title')) : null,
      description: form.get('description') ? String(form.get('description')) : null,
    };
    if (file && typeof file.arrayBuffer === 'function' && file.size > 0) return handleFile(file, opts);
    if (url) return handleUrl(String(url), opts);
    return NextResponse.json({ success: false, error: 'Field file (multipart) wajib diisi atau gunakan url' }, { status: 400 });
  }
  // JSON (upload via URL)
  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Body harus JSON: {"url": "..."} atau multipart file' }, { status: 400 });
  }
  return handleUrl(body?.url, {
    expiration: body?.expiration,
    title: body?.title,
    description: body?.description,
  });
}

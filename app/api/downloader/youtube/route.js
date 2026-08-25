/**
 * @title YouTube Downloader
 * @summary Download video/audio YouTube via API vidssave.com.
 * @description Endpoint untuk mengambil link download video atau audio (MP3)
 *              YouTube beserta metadata (judul, thumbnail, durasi) dan daftar
 *              kualitas yang tersedia. Gunakan param type=audio untuk musik/MP3,
 *              atau quality=360P untuk memilih kualitas tertentu. Hanya menerima
 *              URL HTTPS dari domain youtube.com / youtu.be.
 * @method GET
 * @path /api/downloader/youtube
 * @param {string} query.url - URL video YouTube (wajib, https only).
 * @param {string} [query.type] - Jenis media: "video" (default) atau "audio".
 * @choice video - Video (default)
 * @choice audio - Audio / MP3
 * @param {string} [query.quality] - Kualitas spesifik, misal "720P" atau "360P".
 * @response json
 * @example
 * fetch('https://puruboy-api.vercel.app/api/downloader/youtube?url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3DdQw4w9WgXcQ')
 *     .then(res => res.json())
 *     .then(console.log);
 */
import { NextResponse } from 'next/server';
import { downloadYoutube } from '../../../../lib/vidssave.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

function validateUrl(url) {
  if (!url || typeof url !== 'string') return { error: 'Parameter url wajib diisi', status: 400 };
  if (url.length > 2048) return { error: 'URL terlalu panjang', status: 400 };
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return { error: 'URL tidak valid', status: 400 };
  }
  if (parsed.protocol !== 'https:') return { error: 'Hanya URL HTTPS yang didukung', status: 400 };
  const host = parsed.hostname.toLowerCase();
  const ok =
    host === 'youtube.com' ||
    host.endsWith('.youtube.com') ||
    host === 'youtu.be' ||
    host.endsWith('.youtu.be');
  if (!ok) return { error: 'URL harus dari domain youtube.com atau youtu.be', status: 400 };
  return null;
}

async function handle(url, opts) {
  const invalid = validateUrl(url);
  if (invalid) return NextResponse.json({ error: invalid.error }, { status: invalid.status });

  try {
    const result = await downloadYoutube(url, opts);
    return NextResponse.json({
      success: true,
      source: 'vidssave.com',
      ...result,
    });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 502 });
  }
}

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const type = searchParams.get('type') || undefined;
  const quality = searchParams.get('quality') || undefined;
  return handle(searchParams.get('url'), { type, quality });
}

export async function POST(req) {
  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Body harus JSON: {"url": "..."}' }, { status: 400 });
  }
  return handle(body?.url, { type: body?.type, quality: body?.quality });
}

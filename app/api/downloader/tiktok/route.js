/**
 * @title TikTok Downloader
 * @summary Download video TikTok tanpa watermark (via ssstik.io).
 * @description Endpoint untuk mengambil link download video TikTok tanpa watermark
 *              beserta metadata (author, avatar, caption) dan link MP3.
 *              Hanya menerima URL HTTPS (http ditolak). Juga mendukung method
 *              POST dengan body JSON {"url": "..."}.
 * @method GET
 * @path /api/downloader/tiktok
 * @param {string} query.url - URL video TikTok (wajib, https only).
 * @response json
 * @example
 * fetch('https://puruboy-api.vercel.app/api/downloader/tiktok?url=https%3A%2F%2Fwww.tiktok.com%2F%40agungdarmawn_%2Fvideo%2F7374017020418870534')
 *     .then(res => res.json())
 *     .then(console.log);
 */
import { NextResponse } from 'next/server';
import { downloadTiktok } from '../../../../lib/ssstik.js';

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
  if (host !== 'tiktok.com' && !host.endsWith('.tiktok.com')) {
    return { error: 'URL harus dari domain tiktok.com', status: 400 };
  }
  return null;
}

async function handle(url) {
  const invalid = validateUrl(url);
  if (invalid) return NextResponse.json({ error: invalid.error }, { status: invalid.status });

  try {
    const result = await downloadTiktok(url);
    return NextResponse.json({
      success: true,
      source: 'ssstik.io',
      ...result,
    });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 502 });
  }
}

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  return handle(searchParams.get('url'));
}

export async function POST(req) {
  let url = null;
  try {
    const body = await req.json();
    url = body?.url;
  } catch {
    return NextResponse.json({ error: 'Body harus JSON: {"url": "..."}' }, { status: 400 });
  }
  return handle(url);
}

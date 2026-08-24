/**
 * @title Instagram Downloader
 * @summary Download media Instagram (Reels, Post, IGTV, Carousel) tanpa watermark.
 * @description Mengambil link download video/foto dari URL Instagram publik
 *              (https only, tanpa menjalankan browser). Mendukung link /p/, /reel/,
 *              /reels/, /tv/, dan /share/. Link CDN Instagram kedaluwarsa ±1 jam;
 *              tersedia juga proxy_url (cdn.instasave.website) sebagai alternatif.
 * @method GET
 * @path /api/downloader/instagram
 * @param {string} query.url - URL Instagram publik (wajib, https only).
 * @response json
 * @example
 * fetch('https://puruboy-api.vercel.app/api/downloader/instagram?url=https%3A%2F%2Fwww.instagram.com%2Freel%2FDVDX96NCdXc%2F')
 *     .then(res => res.json())
 *     .then(console.log);
 */
import { NextResponse } from 'next/server';
import { downloadInstagram } from '../../../../lib/instagram.js';

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
  const okHost =
    host === 'instagram.com' ||
    host.endsWith('.instagram.com') ||
    host === 'instagr.am' ||
    host.endsWith('.instagr.am');
  if (!okHost) return { error: 'URL harus dari domain instagram.com', status: 400 };
  return null;
}

async function handle(url) {
  const invalid = validateUrl(url);
  if (invalid) return NextResponse.json({ success: false, error: invalid.error }, { status: invalid.status });

  try {
    const result = await downloadInstagram(url);
    return NextResponse.json({ success: true, source: 'instasave.website', ...result });
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
    return NextResponse.json({ success: false, error: 'Body harus JSON: {"url": "..."}' }, { status: 400 });
  }
  return handle(url);
}

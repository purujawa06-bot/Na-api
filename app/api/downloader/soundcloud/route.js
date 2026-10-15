/**
 * @title SoundCloud Downloader
 * @summary Download track SoundCloud (MP3 128 kbps) tanpa watermark & tanpa browser.
 * @description Mengambil link stream/download audio dari URL track SoundCloud publik.
 *              Selalu merespons JSON (tanpa redirect/proxy byte): hasilnya berisi
 *              metadata + stream_url/download_url CDN. Track Go+ (policy SNIP)
 *              hanya menghasilkan preview 30 detik (ditandai is_preview=true).
 *              Link kedaluwarsa ±1 jam.
 * @method GET
 * @path /api/downloader/soundcloud
 * @param {string} query.url - URL track SoundCloud publik (wajib, https only).
 * @response json
 * @example
 * fetch('https://puruboy-api.vercel.app/api/downloader/soundcloud?url=https%3A%2F%2Fsoundcloud.com%2Fdeanlofi%2Fwinter-night-lofi-hip-hop')
 *     .then(res => res.json())
 *     .then(console.log);
 */
import { NextResponse } from 'next/server';
import { downloadSoundCloud } from '../../../../lib/soundcloud.js';
import { cachedJson } from '../../../../lib/api-cache.js';

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
  if (host !== 'soundcloud.com' && !host.endsWith('.soundcloud.com')) {
    return { error: 'URL harus dari domain soundcloud.com', status: 400 };
  }
  return null;
}

async function handle(url, cacheReq) {
  const invalid = validateUrl(url);
  if (invalid) {
    return NextResponse.json({ success: false, error: invalid.error }, { status: invalid.status });
  }

  try {
    const produce = async () => {
      const result = await downloadSoundCloud(url);
      return NextResponse.json({ success: true, source: 'api-v2.soundcloud.com', ...result });
    };
    if (cacheReq) {
      return await cachedJson(cacheReq, { ttl: 604800, stale: 86400 }, produce);
    }
    return await produce();
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 502 });
  }
}

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  return handle(searchParams.get('url'), req);
}

export async function POST(req) {
  let url = null;
  try {
    const body = await req.json();
    url = body?.url;
  } catch {
    return NextResponse.json({ success: false, error: 'Body harus JSON: {"url": "..."}' }, { status: 400 });
  }
  return handle(url, null);
}

/**
 * @title SoundCloud Downloader
 * @summary Download track SoundCloud (MP3 128 kbps) tanpa watermark & tanpa browser.
 * @description Mengambil link stream/download audio dari URL track SoundCloud publik.
 *              Utama: progressive MP3 tunggal; bila tidak ada, HLS segment MP3 digabung
 *              otomatis dengan ?raw=1. Track Go+ (policy SNIP) hanya menghasilkan preview
 *              30 detik (ditandai is_preview=true). Link kedaluwarsa ±1 jam.
 * @method GET
 * @path /api/downloader/soundcloud
 * @param {string} query.url - URL track SoundCloud publik (wajib, https only).
 * @param {string} [query.raw] - Format output yang diinginkan.
 *        @choice 0 - JSON Metadata & Link (Default)
 *        @choice 1 - Redirect 302 langsung ke file audio CDN (hemat kuota,
 *                    tanpa proxy byte via function; client mengikuti redirect otomatis).
 * @response json
 * @example
 * fetch('https://puruboy-api.vercel.app/api/downloader/soundcloud?url=https%3A%2F%2Fsoundcloud.com%2Fdeanlofi%2Fwinter-night-lofi-hip-hop')
 *     .then(res => res.json())
 *     .then(console.log);
 */
import { NextResponse } from 'next/server';
import { downloadSoundCloud } from '../../../../lib/soundcloud.js';
import {
  cachedJson,
  cacheControlHeader,
  getOrSet,
} from '../../../../lib/api-cache.js';

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

// Signed CDN links expire after ~1 hour, so both the resolve memo and the
// redirect cache stay well under that lifetime.
const RESOLVE_TTL_MS = 30 * 60 * 1000;
const RESOLVE_STALE_MS = 10 * 60 * 1000;

// Quota guard: never proxy audio bytes through the function. Resolving the
// signed CDN URL costs one cheap JSON call; the bytes then flow directly
// from SoundCloud's CDN to the client (302 redirect).
async function redirectToAudio(url) {
  const key = `sc:resolve:${url}`;
  const { value: result, hit } = await getOrSet(
    key,
    RESOLVE_TTL_MS,
    RESOLVE_STALE_MS,
    () => downloadSoundCloud(url)
  );
  if (result.is_preview) {
    return NextResponse.json(
      { success: false, error: 'Track ini hanya tersedia preview 30 detik (Go+/SNIP)' },
      { status: 502 }
    );
  }
  const target = result.download_url || result.stream_url;
  return new NextResponse(null, {
    status: 302,
    headers: {
      location: target,
      'cache-control': cacheControlHeader(1800, 600),
      'x-cache': hit,
    },
  });
}

async function handle(url, raw, cacheReq) {
  const invalid = validateUrl(url);
  if (invalid) {
    // raw mode tetap balas JSON agar error terbaca
    return NextResponse.json({ success: false, error: invalid.error }, { status: invalid.status });
  }

  try {
    if (raw === '1') {
      return await redirectToAudio(url);
    }

    const produce = async () => {
      const result = await downloadSoundCloud(url);
      return NextResponse.json({ success: true, source: 'api-v2.soundcloud.com', ...result });
    };
    if (cacheReq) {
      return await cachedJson(cacheReq, { ttl: 1800, stale: 600 }, produce);
    }
    return await produce();
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 502 });
  }
}

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  return handle(searchParams.get('url'), searchParams.get('raw'), req);
}

export async function POST(req) {
  let url = null;
  let raw = null;
  try {
    const body = await req.json();
    url = body?.url;
    raw = body?.raw != null ? String(body.raw) : null;
  } catch {
    return NextResponse.json({ success: false, error: 'Body harus JSON: {"url": "..."}' }, { status: 400 });
  }
  return handle(url, raw, null);
}

/**
 * @title SoundCloud Play
 * @summary Cari dan dapatkan direct stream URL track SoundCloud berdasarkan query pencarian.
 * @description Mencari track di SoundCloud berdasarkan kata kunci `q`, kemudian mengambil direct URL stream MP3 beserta metadata judul dan durasinya.
 * @method GET
 * @path /api/play/soundcloud
 * @param {string} query.q - Kata kunci pencarian lagu SoundCloud (wajib).
 * @response json
 * @example
 * fetch('[https://puruboy-api.vercel.app/api/play/soundcloud?q=dj%20ya%20odna](https://puruboy-api.vercel.app/api/play/soundcloud?q=dj%20ya%20odna)')
 *     .then(res => res.json())
 *     .then(console.log);
 */
import { NextResponse } from 'next/server';
import { searchSoundCloud, downloadSoundCloud } from '../../../../lib/soundcloud.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

function formatDuration(ms) {
  if (!ms || isNaN(ms)) return '0:00';
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

async function handle(q) {
  if (!q || typeof q !== 'string' || !q.trim()) {
    return NextResponse.json({ success: false, error: 'Parameter q wajib diisi' }, { status: 400 });
  }
  if (q.length > 200) {
    return NextResponse.json({ success: false, error: 'Query terlalu panjang (maks 200 karakter)' }, { status: 400 });
  }

  try {
    const searchRes = await searchSoundCloud(q.trim(), { type: 'tracks', limit: 1 });
    const firstTrack = searchRes.results?.[0];

    if (!firstTrack || !firstTrack.permalink_url) {
      return NextResponse.json({ success: false, error: 'Lagu tidak ditemukan' }, { status: 404 });
    }

    const dlRes = await downloadSoundCloud(firstTrack.permalink_url);
    const directUrl = dlRes.download_url || dlRes.stream_url;

    if (!directUrl) {
      return NextResponse.json({ success: false, error: 'Gagal mengambil URL audio' }, { status: 502 });
    }

    return NextResponse.json({
      success: true,
      author: 'NextA',
      result: {
        title: dlRes.title || firstTrack.title,
        duration: formatDuration(dlRes.duration_ms || firstTrack.duration_ms),
        url: directUrl
      }
    });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 502 });
  }
}

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  return handle(searchParams.get('q'));
}

export async function POST(req) {
  let q = null;
  try {
    const body = await req.json();
    q = body?.q;
  } catch {
    return NextResponse.json({ success: false, error: 'Body harus JSON: {"q": "..."}' }, { status: 400 });
  }
  return handle(q);
}

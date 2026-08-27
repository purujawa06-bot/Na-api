/**
 * @title SoundCloud Play
 * @summary Cari lagu dari kata kunci dan dapatkan direct stream URL MP3 SoundCloud.
 * @description Mencari track di SoundCloud berdasarkan kata kunci q (mengambil
 *              hasil teratas), lalu mengambil direct URL stream MP3 128 kbps
 *              beserta metadata judul dan durasinya. Track Go+ (policy SNIP)
 *              hanya menghasilkan preview 30 detik (ditandai is_preview=true).
 *              Link stream kedaluwarsa ±1 jam.
 * @method GET
 * @path /api/play/soundcloud
 * @param {string} query.q - Kata kunci pencarian lagu SoundCloud (wajib).
 * @response json
 * @example
 * fetch('https://puruboy-api.vercel.app/api/play/soundcloud?q=dj%20ya%20odna')
 *     .then(res => res.json())
 *     .then(console.log);
 */
/**
 * @title SoundCloud Play (Direct)
 * @summary Cari dan dapatkan stream URL MP3 SoundCloud.
 * @description Mencari track di SoundCloud dan mengembalikan metadata beserta link stream MP3 128kbps.
 * @method GET
 * @path /api/play/soundcloud
 * @param {string} query.q - Kata kunci pencarian (Judul/Artis).
 */
import { NextResponse } from 'next/server';
import { searchSoundCloud, downloadSoundCloud } from '../../../../lib/soundcloud.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get('q');
  if (!q || !q.trim()) {
    return NextResponse.json(
      { success: false, error: 'Parameter "q" wajib diisi' },
      { status: 400 }
    );
  }

  try {
    // Ambil hasil pencarian teratas (type=tracks, limit=1)
    const searchResult = await searchSoundCloud(q.trim(), { type: 'tracks', limit: 1 });
    const track = searchResult.results[0];
    if (!track) {
      return NextResponse.json({ success: false, error: 'Track tidak ditemukan' }, { status: 404 });
    }

    // downloadSoundCloud mengembalikan objek metadata + stream_url (bukan string)
    const dl = await downloadSoundCloud(track.permalink_url);

    return NextResponse.json({
      success: true,
      source: 'api-v2.soundcloud.com',
      query: q.trim(),
      track: {
        id: dl.id,
        title: dl.title,
        author: dl.user?.username ?? null,
        duration_ms: dl.duration_ms,
        artwork_url: dl.artwork_url,
        permalink_url: dl.permalink_url,
        policy: dl.policy,
        is_preview: dl.is_preview,
        stream_url: dl.stream_url,
      },
    });
  } catch (err) {
    return NextResponse.json({ success: false, error: err.message }, { status: 502 });
  }
}

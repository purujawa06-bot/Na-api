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
import { searchSoundCloud, downloadSoundCloud } from '../../../../lib/soundcloud.js';
import { NextResponse } from 'next/server';

export async function GET(req) {
    try {
        const { searchParams } = new URL(req.url);
        const q = searchParams.get('q');
        if (!q) {
            return NextResponse.json({ success: false, error: 'Parameter "q" wajib diisi' }, { status: 400 });
        }

        const searchResult = await searchSoundCloud(q, 'tracks', 1);
        if (!searchResult.items || searchResult.items.length === 0) {
            return NextResponse.json({ success: false, error: 'Track tidak ditemukan' }, { status: 404 });
        }

        const track = searchResult.items[0];
        const streamUrl = await downloadSoundCloud(track.permalink_url);

        return NextResponse.json({
            success: true,
            source: 'api-v2.soundcloud.com',
            query: q,
            track: {
                id: track.id,
                title: track.title,
                duration_ms: track.duration,
                duration_formatted: track.duration_formatted,
                artwork_url: track.artwork_url,
                permalink_url: track.permalink_url,
                stream_url: streamUrl
            }
        });
    } catch (err) {
        return NextResponse.json({ success: false, error: err.message }, { status: 500 });
    }
}

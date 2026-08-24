/**
 * @title SoundCloud Search
 * @summary Cari track, playlist, album, dan user di SoundCloud.
 * @description Pencarian via api-v2.soundcloud.com (hasil reverse-engineering,
 *              tanpa browser). Hasil berupa daftar item dengan tipe "track",
 *              "playlist", "album", atau "user". Item track bertanda
 *              is_preview=true hanya preview 30 detik (Go+/SNIP).
 *              Gunakan parameter type untuk memfilter jenis hasil, dan
 *              next_offset dari response untuk mengambil halaman berikutnya.
 * @method GET
 * @path /api/search/soundcloud
 * @param {string} query.q - Kata kunci pencarian (wajib).
 * @param {string} [query.type] - Filter jenis hasil.
 *   @choice all - Semua jenis (default)
 *   @choice tracks - Hanya track
 *   @choice playlists - Hanya playlist
 *   @choice albums - Hanya album
 *   @choice users - Hanya user/artis
 * @param {number} [query.limit] - Jumlah hasil per halaman (1-50, default 20).
 * @param {number} [query.offset] - Offset paginasi (default 0). Pakai nilai
 *   next_offset dari response sebelumnya untuk halaman berikutnya.
 * @response json
 * @example
 * fetch('https://puruboy-api.vercel.app/api/search/soundcloud?q=winter%20night%20lofi&type=tracks&limit=10')
 *     .then(res => res.json())
 *     .then(console.log);
 */
import { NextResponse } from 'next/server';
import { searchSoundCloud } from '../../../../lib/soundcloud.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

async function handle(q, type, limit, offset) {
  if (!q || typeof q !== 'string' || !q.trim()) {
    return NextResponse.json({ success: false, error: 'Parameter q wajib diisi' }, { status: 400 });
  }
  if (q.length > 200) {
    return NextResponse.json({ success: false, error: 'Query terlalu panjang (maks 200 karakter)' }, { status: 400 });
  }
  const validTypes = ['all', 'tracks', 'playlists', 'albums', 'users'];
  const t = String(type || 'all').toLowerCase();
  if (!validTypes.includes(t)) {
    return NextResponse.json(
      { success: false, error: `type tidak valid. Pilihan: ${validTypes.join(', ')}` },
      { status: 400 }
    );
  }

  try {
    const result = await searchSoundCloud(q.trim(), { type: t, limit, offset });
    return NextResponse.json({ success: true, source: 'api-v2.soundcloud.com', query: q.trim(), ...result });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 502 });
  }
}

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  return handle(searchParams.get('q'), searchParams.get('type'), searchParams.get('limit'), searchParams.get('offset'));
}

export async function POST(req) {
  let q = null;
  let type = null;
  let limit = null;
  let offset = null;
  try {
    const body = await req.json();
    q = body?.q;
    type = body?.type;
    limit = body?.limit != null ? String(body.limit) : null;
    offset = body?.offset != null ? String(body.offset) : null;
  } catch {
    return NextResponse.json({ success: false, error: 'Body harus JSON: {"q": "..."}' }, { status: 400 });
  }
  return handle(q, type, limit, offset);
}

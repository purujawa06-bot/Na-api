/**
 * @title PurTV Series
 * @summary Halaman seri — data Wibutime (single source).
 * @description Mengambil halaman seri. URL `/series/ancient-war-soul/` (wibutime.local) → data Wibutime.
 *               Menyertakan judul,
 *              genre, sinopsis, info produksi, daftar episode, dan `purtv_pagenation`.
 * @method GET
 * @path /api/purtv/series
 * @param {string} query.url - URL halaman seri (bisa dari navigation.allEpisodes).
 * @response json
 * @example
 * fetch('https://na-api-nue-api-e7bfd3f4.koyeb.app/api/purtv/series?url=https://wibutime.local/series/ancient-war-soul/')
 *     .then(res => res.json())
 *     .then(console.log);
 */
import { NextResponse } from 'next/server';
import { fetchPurtvSeries } from '../../../../lib/purtv.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const url = searchParams.get('url');
  if (!url) {
    return NextResponse.json({ success: false, error: 'Parameter url wajib diisi.' }, { status: 400 });
  }
  try {
    const data = await fetchPurtvSeries(url);
    return NextResponse.json({ success: true, ...data });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 502 });
  }
}
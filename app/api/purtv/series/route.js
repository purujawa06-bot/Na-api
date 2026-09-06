/**
 * @title PurTV Series
 * @summary Halaman seri donghua — info lengkap + daftar seluruh episode.
 * @description Mengambil halaman seri (`/seri/<slug>/`) dari sumber PurTV
 *              (anichin.cafe): judul, genre, sinopsis, info produksi (status,
 *              studio, tipe, rilis, dll), dan daftar seluruh episode beserta URL-nya.
 * @method GET
 * @path /api/purtv/series
 * @param {string} query.url - URL halaman seri (bisa dari navigation.allEpisodes).
 * @response json
 * @example
 * fetch('https://puruboy-api.vercel.app/api/purtv/series?url=https://anichin.cafe/seri/soul-land/')
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
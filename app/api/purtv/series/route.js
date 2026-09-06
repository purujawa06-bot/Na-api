/**
 * @title PurTV Series
 * @summary Halaman seri — gabungan donghua (anichin) + anime (samehadaku).
 * @description Mengambil halaman seri. URL `/seri/<slug>/` (anichin.cafe) → donghua;
 *              URL `/anime/<slug>/` (v2.samehadaku.how) → anime. Menyertakan judul,
 *              genre, sinopsis, info produksi, daftar episode, dan `purtv_pagenation`.
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
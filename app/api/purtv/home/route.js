/**
 * @title PurTV Home
 * @summary Beranda purtv.vercel.app — gabungan donghua + anime.
 * @description Mengambil data halaman beranda sumber PurTV (anichin.cafe) dan
 *              anime (samehadaku): featured slider, populer, terbaru, ongoing,
 *              rekomendasi per genre, plus anime terbaru & populer. Setiap respon
 *              menyertakan `purtv_pagenation`.
 * @method GET
 * @path /api/purtv/home
 * @response json
 * @example
 * fetch('https://puruboy-api.vercel.app/api/purtv/home')
 *     .then(res => res.json())
 *     .then(console.log);
 */
import { NextResponse } from 'next/server';
import { fetchPurtvHome } from '../../../../lib/purtv.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET() {
  try {
    const data = await fetchPurtvHome();
    return NextResponse.json({ success: true, ...data });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 502 });
  }
}
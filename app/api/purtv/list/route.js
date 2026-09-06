/**
 * @title PurTV List Genre
 * @summary Listing per genre — gabungan donghua (anichin) + anime (samehadaku).
 * @description Menampilkan daftar donghua dan anime yang difilter berdasarkan
 *              genre dan halaman, mengikuti pola PurTV: anichin
 *              (`/seri/?genre[]=<slug>&page=N`) + samehadaku
 *              (`/genre/<slug>/?order=latest`). Setiap item diberi penanda
 *              `source` ('anichin'/'samehadaku'). Halaman di luar daftar
 *              mengembalikan hasil kosong (bukan error). Setiap respon menyertakan
 *              `purtv_pagenation`.
 * @method GET
 * @path /api/purtv/list
 * @param {string} [query.genre] - Slug genre (contoh: action, comedy, cultivation).
 * @param {number} [query.page=1] - Halaman hasil.
 * @response json
 * @example
 * fetch('https://puruboy-api.vercel.app/api/purtv/list?genre=action')
 *     .then(res => res.json())
 *     .then(console.log);
 */
import { NextResponse } from 'next/server';
import { fetchPurtvList } from '../../../../lib/purtv.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const genre = searchParams.get('genre') || '';
  const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10) || 1);
  try {
    const data = await fetchPurtvList({ genre, page });
    return NextResponse.json({ success: true, ...data });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 502 });
  }
}
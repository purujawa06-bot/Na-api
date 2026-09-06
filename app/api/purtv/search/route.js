/**
 * @title PurTV Pencarian
 * @summary Cari donghua (anichin) + anime (samehadaku).
 * @description Mencari berdasarkan kata kunci, sama seperti kotak pencarian di
 *              purtv.vercel.app — hasil digabung dari dua sumber. Mendukung
 *              paginasi, tiap item diberi penanda `source`, dan respon menyertakan
 *              `purtv_pagenation`.
 * @method GET
 * @path /api/purtv/search
 * @param {string} query.q - Kata kunci judul. (wajib)
 * @param {number} [query.page=1] - Halaman hasil pencarian.
 * @response json
 * @example
 * fetch('https://puruboy-api.vercel.app/api/purtv/search?q=soul+land')
 *     .then(res => res.json())
 *     .then(console.log);
 */
import { NextResponse } from 'next/server';
import { fetchPurtvSearch } from '../../../../lib/purtv.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get('q');
  if (!q) {
    return NextResponse.json({ success: false, error: 'Parameter q wajib diisi.' }, { status: 400 });
  }
  const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10) || 1);
  try {
    const data = await fetchPurtvSearch(q, page);
    return NextResponse.json({ success: true, ...data });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 502 });
  }
}
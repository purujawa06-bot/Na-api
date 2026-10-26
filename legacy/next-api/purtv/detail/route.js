/**
 * @title PurTV Detail Episode
 * @summary Detail episode — gabungan donghua (anichin) + anime (samehadaku).
 * @description Mengambil detail halaman episode. URL dari anichin.com.co → donghua;
 *              URL dari v2.samehadaku.how → anime. Mencakup judul, seri induk,
 *              sinopsis, player default, daftar server video (halaman mirror
 *              /v/N/ di-resolve ke iframe utk donghua), navigasi episode, dan
 *              `purtv_pagenation`. Situs baru tidak menyediakan link download
 *              (downloadLinks kosong). For anime, server disertakan beserta post/nume/type.
 * @method GET
 * @path /api/purtv/detail
 * @param {string} query.url - URL halaman episode (diambil dari hasil home/search/list).
 * @response json
 * @example
 * fetch('https://puruboy-api.vercel.app/api/purtv/detail?url=https://anichin.com.co/soul-land-episode-1/')
 *     .then(res => res.json())
 *     .then(console.log);
 */
import { NextResponse } from 'next/server';
import { fetchPurtvDetail } from '../../../../lib/purtv.js';

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
    const data = await fetchPurtvDetail(url);
    return NextResponse.json({ success: true, ...data });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 502 });
  }
}

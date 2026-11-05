/**
 * @title PurTV Detail Episode
 * @summary Detail episode — data Wibutime (single source).
 * @description Mengambil detail halaman episode. URL dari wibutime (Supabase) → donghua;
 *              URL dari v2.wibutime.how → anime. Mencakup judul, seri induk,
 *              sinopsis, player default, daftar server video (halaman mirror
 *              /v/N/ di-resolve ke iframe utk donghua), navigasi episode, dan
 *              `purtv_pagenation`. Situs baru tidak menyediakan link download
 *              (downloadLinks kosong). For anime, server disertakan beserta post/nume/type.
 * @method GET
 * @path /api/purtv/detail
 * @param {string} query.url - URL halaman episode (diambil dari hasil home/search/list).
 * @response json
 * @example
 * fetch('https://na-api-nue-api-e7bfd3f4.koyeb.app/api/purtv/detail?url=https://wibutime.local/episode/tensei-shitara-ken-deshita-ii-ep-1/')
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

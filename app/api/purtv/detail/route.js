/**
 * @title PurTV Detail Episode
 * @summary Detail episode donghua — judul, seri induk, server video, navigasi.
 * @description Mengambil detail halaman episode dari sumber PurTV (anichin.cafe):
 *              judul, seri induk, sinopsis, player default, daftar server video
 *              (nilai base64 di-decode jadi URL iframe), link download (jika ada),
 *              serta navigasi episode sebelumnya/berikutnya.
 * @method GET
 * @path /api/purtv/detail
 * @param {string} query.url - URL halaman episode (diambil dari hasil home/search/list).
 * @response json
 * @example
 * fetch('https://puruboy-api.vercel.app/api/purtv/detail?url=https://anichin.cafe/soul-land-episode-1/')
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
/**
 * @title Komiku Genre
 * @summary Daftar komik per genre + daftar semua genre komiku.org.
 * @description Mengambil komik dalam sebuah genre (slug, mis. "isekai",
 *              "fantasy", "romance") dengan pagination. Tanpa parameter genre
 *              default "isekai". Respons juga memuat daftar semua genre yang
 *              tersedia. Tanpa browser — cukup HTTPS.
 * @method GET
 * @path /api/komiku/genre
 * @param {string} [query.genre] - Slug genre (mis. isekai, fantasy, action).
 * @param {string} [query.page] - Nomor halaman, mulai dari 1 (default: 1).
 * @response json
 * @example
 * fetch('https://puruboy-api.vercel.app/api/komiku/genre?genre=isekai')
 *     .then(res => res.json())
 *     .then(console.log);
 */
import { NextResponse } from 'next/server';
import { fetchKomikuGenre } from '../../../../lib/komiku.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const genre = (searchParams.get('genre') || 'isekai').toLowerCase().trim();
  const pageRaw = searchParams.get('page');

  if (genre.length > 50 || !/^[a-z0-9-]+$/.test(genre)) {
    return NextResponse.json({ error: 'genre tidak valid (hanya huruf/angka/tanda hubung)' }, { status: 400 });
  }

  let page = 1;
  if (pageRaw) {
    if (!/^\d+$/.test(pageRaw)) {
      return NextResponse.json({ error: 'Parameter page harus berupa angka' }, { status: 400 });
    }
    page = parseInt(pageRaw, 10);
    if (page < 1 || page > 5000) {
      return NextResponse.json({ error: 'Parameter page di luar jangkauan (1-5000)' }, { status: 400 });
    }
  }

  try {
    const data = await fetchKomikuGenre(genre, page);
    return NextResponse.json({ success: true, ...data });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 502 });
  }
}

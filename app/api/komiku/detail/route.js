/**
 * @title Komiku Detail
 * @summary Detail komik + daftar chapter + komik serupa dari komiku.org.
 * @description Mengambil info lengkap sebuah komik (judul, judul alternatif,
 *              tipe, tema, genre, author, rating, pembaca, sinopsis), daftar
 *              chapter terurut, serta komik serupa. Parameter slug = bagian
 *              URL setelah /manga/, mis. "my-wife-waited-for-me-in-the-wheat-field".
 * @method GET
 * @path /api/komiku/detail
 * @param {string} query.slug - Slug permalink komik (wajib, mis. "one-piece").
 * @response json
 * @example
 * fetch('https://puruboy-api.vercel.app/api/komiku/detail?slug=my-wife-waited-for-me-in-the-wheat-field')
 *     .then(res => res.json())
 *     .then(console.log);
 */
import { NextResponse } from 'next/server';
import { fetchKomikuDetail } from '../../../../lib/komiku.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const slug = searchParams.get('slug');

  if (!slug || typeof slug !== 'string' || !slug.trim()) {
    return NextResponse.json({ error: 'Parameter slug wajib diisi' }, { status: 400 });
  }
  if (slug.length > 300) return NextResponse.json({ error: 'slug terlalu panjang' }, { status: 400 });
  if (!/^[a-z0-9-]+$/i.test(slug.trim())) {
    return NextResponse.json({ error: 'slug hanya boleh berisi huruf, angka, dan tanda hubung' }, { status: 400 });
  }

  try {
    const data = await fetchKomikuDetail(slug.trim());
    if (!data.title) {
      return NextResponse.json({ success: false, error: 'Komik tidak ditemukan' }, { status: 404 });
    }
    return NextResponse.json({ success: true, ...data });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 502 });
  }
}

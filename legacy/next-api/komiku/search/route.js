/**
 * @title Komiku Search
 * @summary Cari komik di komiku.org (post_type=manga).
 * @description Mencari komik berdasarkan kata kunci (mis. "boruto") dengan
 *              pagination. Hasil memuat judul, cover, tipe, genre/tema, dan
 *              chapter awal/terbaru. Tanpa browser — cukup HTTPS.
 * @method GET
 * @path /api/komiku/search
 * @param {string} query.q - Kata kunci pencarian (wajib).
 * @param {string} [query.page] - Nomor halaman, mulai dari 1 (default: 1).
 * @response json
 * @example
 * fetch('https://puruboy-api.vercel.app/api/komiku/search?q=boruto')
 *     .then(res => res.json())
 *     .then(console.log);
 */
import { NextResponse } from 'next/server';
import { fetchKomikuSearch } from '../../../../lib/komiku.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get('q');
  const pageRaw = searchParams.get('page');

  if (!q || typeof q !== 'string' || !q.trim()) {
    return NextResponse.json({ error: 'Parameter q (kata kunci) wajib diisi' }, { status: 400 });
  }
  if (q.length > 100) return NextResponse.json({ error: 'Kata kunci terlalu panjang' }, { status: 400 });

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
    const data = await fetchKomikuSearch(q.trim(), page);
    return NextResponse.json({ success: true, ...data });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 502 });
  }
}

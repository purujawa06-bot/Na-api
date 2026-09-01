/**
 * @title Komiku Pustaka
 * @summary Listing perpustakaan komiku.org dengan filter tipe, orderby, genre, status.
 * @description Mengambil daftar komik dari pustaka komiku.org (manga, manhwa,
 *              manhua, atau semua). Mendukung pagination serta filter tipe,
 *              orderby (modified/date/meta_value_num/rand), genre 1 & 2, dan
 *              status (ongoing/end). Tanpa browser — cukup HTTPS.
 * @method GET
 * @path /api/komiku/pustaka
 * @param {string} [query.tipe] - Jenis komik.
 *        @choice manga - Manga
 *        @choice manhwa - Manhwa
 *        @choice manhua - Manhua
 * @param {string} [query.page] - Nomor halaman, mulai dari 1 (default: 1).
 * @param {string} [query.orderby] - Pengurutan.
 *        @choice modified - Chapter Terbaru (Default)
 *        @choice date - Komik Terbaru
 *        @choice meta_value_num - Peringkat
 *        @choice rand - Acak
 * @param {string} [query.genre] - Slug genre (mis. action, fantasy, isekai).
 * @param {string} [query.genre2] - Slug genre kedua.
 * @param {string} [query.status] - Status komik.
 *        @choice ongoing - Ongoing
 *        @choice end - Tamat
 * @response json
 * @example
 * fetch('https://puruboy-api.vercel.app/api/komiku/pustaka?tipe=manhwa&page=2')
 *     .then(res => res.json())
 *     .then(console.log);
 */
import { NextResponse } from 'next/server';
import { fetchKomikuPustaka, KOMIKU_TIPES } from '../../../../lib/komiku.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const tipe = (searchParams.get('tipe') || '').toLowerCase();
  const orderby = (searchParams.get('orderby') || '').toLowerCase();
  const genre = searchParams.get('genre') || '';
  const genre2 = searchParams.get('genre2') || '';
  const status = (searchParams.get('status') || '').toLowerCase();
  const pageRaw = searchParams.get('page');

  if (tipe && !KOMIKU_TIPES.includes(tipe)) {
    return NextResponse.json(
      { error: `tipe tidak didukung. Pilihan: ${KOMIKU_TIPES.filter(Boolean).join(', ')}` },
      { status: 400 }
    );
  }
  const allowedOrder = ['', 'modified', 'date', 'meta_value_num', 'rand'];
  if (!allowedOrder.includes(orderby)) {
    return NextResponse.json({ error: 'orderby tidak didukung' }, { status: 400 });
  }
  const allowedStatus = ['', 'ongoing', 'end'];
  if (!allowedStatus.includes(status)) {
    return NextResponse.json({ error: 'status tidak didukung. Pilihan: ongoing, end' }, { status: 400 });
  }
  if (genre.length > 50 || genre2.length > 50) {
    return NextResponse.json({ error: 'genre terlalu panjang' }, { status: 400 });
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
    const data = await fetchKomikuPustaka({ tipe, page, orderby, genre, genre2, status });
    return NextResponse.json({ success: true, ...data });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 502 });
  }
}

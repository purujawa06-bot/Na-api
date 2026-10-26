/**
 * @title DramaBox Search
 * @summary Cari drama pendek di dramabox.com.
 * @description Mencari drama berdasarkan kata kunci dengan pagination
 *              (20 hasil per halaman) plus rekomendasi serupa. Tanpa browser.
 * @method GET
 * @path /api/dramabox/search
 * @param {string} query.q - Kata kunci pencarian (wajib).
 * @param {string} [query.page] - Nomor halaman, mulai dari 1 (default: 1).
 * @param {string} [query.locale] - Kode bahasa konten.
 *        @choice in - Indonesia (Default)
 *        @choice en - English
 *        @choice th - Thai
 *        @choice es - Spanish
 *        @choice pt - Portuguese
 *        @choice fr - French
 *        @choice de - German
 *        @choice it - Italian
 *        @choice tr - Turkish
 *        @choice vi - Vietnamese
 *        @choice ja - Japanese
 *        @choice ko - Korean
 *        @choice zh - Chinese
 * @response json
 * @example
 * fetch('https://puruboy-api.vercel.app/api/dramabox/search?q=cinta')
 *     .then(res => res.json())
 *     .then(console.log);
 */
import { NextResponse } from 'next/server';
import { fetchDramaboxSearch, DRAMABOX_LOCALES } from '../../../../lib/dramabox.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get('q');
  const pageRaw = searchParams.get('page');
  const locale = searchParams.get('locale') || 'in';

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
    if (page < 1 || page > 500) {
      return NextResponse.json({ error: 'Parameter page di luar jangkauan (1-500)' }, { status: 400 });
    }
  }

  if (!DRAMABOX_LOCALES.includes(locale)) {
    return NextResponse.json(
      { error: `locale tidak didukung. Pilihan: ${DRAMABOX_LOCALES.join(', ')}` },
      { status: 400 }
    );
  }

  try {
    const data = await fetchDramaboxSearch(q.trim(), page, locale);
    return NextResponse.json({ success: true, source: 'dramabox.com', ...data });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 502 });
  }
}

/**
 * @title DramaBox Category
 * @summary Daftar drama per kategori + daftar semua kategori dramabox.com.
 * @description Tanpa id: mengembalikan daftar semua kategori. Dengan id:
 *              mengembalikan daftar drama dalam kategori tersebut (12 per
 *              halaman) beserta pagination. Tanpa browser — cukup HTTPS.
 * @method GET
 * @path /api/dramabox/category
 * @param {string} [query.id] - ID kategori (typeTwoId, mis. 447 = Romansa).
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
 * fetch('https://puruboy-api.vercel.app/api/dramabox/category?id=447')
 *     .then(res => res.json())
 *     .then(console.log);
 */
import { NextResponse } from 'next/server';
import { fetchDramaboxCategory, DRAMABOX_LOCALES } from '../../../../lib/dramabox.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  const pageRaw = searchParams.get('page');
  const locale = searchParams.get('locale') || 'in';

  if (id && (typeof id !== 'string' || !/^\d+$/.test(id))) {
    return NextResponse.json({ error: 'Parameter id harus berupa angka (typeTwoId)' }, { status: 400 });
  }

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
    const data = await fetchDramaboxCategory(id || 'all', page, locale);
    return NextResponse.json({ success: true, source: 'dramabox.com', ...data });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 502 });
  }
}

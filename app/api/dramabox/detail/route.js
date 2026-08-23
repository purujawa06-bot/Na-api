/**
 * @title DramaBox Detail
 * @summary Detail drama pendek + daftar episode dari dramabox.com.
 * @description Mengambil info lengkap sebuah drama (sinopsis, genre, pemain,
 *              episode, drama terkait, bahasa) tanpa menjalankan browser.
 *              Episode gratis menyertakan video_url siap putar.
 * @method GET
 * @path /api/dramabox/detail
 * @param {string} query.id - ID drama (bookId) dari dramabox.com (wajib).
 * @param {string} [query.locale] - Kode bahasa konten (default: "in").
 * @response json
 * @example
 * fetch('https://puruboy-api.vercel.app/api/dramabox/detail?id=41000105764')
 *     .then(res => res.json())
 *     .then(console.log);
 */
import { NextResponse } from 'next/server';
import { fetchDramaboxDetail, DRAMABOX_LOCALES } from '../../../../lib/dramabox.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

function validateId(id) {
  if (!id || typeof id !== 'string' || !/^\d+$/.test(id)) {
    return 'Parameter id wajib berupa angka (bookId)';
  }
  if (id.length > 20) return 'Parameter id terlalu panjang';
  return null;
}

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  const locale = searchParams.get('locale') || 'in';

  const invalid = validateId(id);
  if (invalid) return NextResponse.json({ error: invalid }, { status: 400 });
  if (!DRAMABOX_LOCALES.includes(locale)) {
    return NextResponse.json(
      { error: `locale tidak didukung. Pilihan: ${DRAMABOX_LOCALES.join(', ')}` },
      { status: 400 }
    );
  }

  try {
    const data = await fetchDramaboxDetail(id, locale);
    return NextResponse.json({ success: true, source: 'dramabox.com', ...data });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 502 });
  }
}

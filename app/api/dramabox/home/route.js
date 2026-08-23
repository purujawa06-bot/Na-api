/**
 * @title DramaBox Home
 * @summary Daftar drama pendek populer dari dramabox.com.
 * @description Mengambil data halaman beranda dramabox.com (drama unggulan &
 *              seksi rekomendasi) tanpa menjalankan browser — cukup HTTPS
 *              server-side. Parameter locale opsional (default: "in").
 * @method GET
 * @path /api/dramabox/home
 * @param {string} [query.locale] - Kode bahasa konten (default: "in").
 *   @choice in - Indonesia
 *   @choice en - English
 *   @choice es - Español
 *   @choice ko - 한국어
 *   @choice zh - 中文
 *   @choice ja - 日本語
 *   @choice th - ไทย
 *   @choice vi - Tiếng Việt
 * @response json
 * @example
 * fetch('https://puruboy-api.vercel.app/api/dramabox/home')
 *     .then(res => res.json())
 *     .then(console.log);
 */
import { NextResponse } from 'next/server';
import { fetchDramaboxHome, DRAMABOX_LOCALES } from '../../../../lib/dramabox.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const locale = searchParams.get('locale') || 'in';

  if (!DRAMABOX_LOCALES.includes(locale)) {
    return NextResponse.json(
      { error: `locale tidak didukung. Pilihan: ${DRAMABOX_LOCALES.join(', ')}` },
      { status: 400 }
    );
  }

  try {
    const data = await fetchDramaboxHome(locale);
    return NextResponse.json({
      success: true,
      source: 'dramabox.com',
      ...data,
    });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 502 });
  }
}

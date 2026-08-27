/**
 * @title DramaBox Stream
 * @summary Link video (mp4) episode drama dari dramabox.com.
 * @description Mengambil URL video langsung sebuah episode drama berdasarkan
 *              bookId + chapterId. Hanya episode gratis (unlock) yang tersedia;
 *              episode berbayar akan ditolak. Tanpa browser — cukup HTTPS.
 * @method GET
 * @path /api/dramabox/stream
 * @param {string} query.id - ID drama (bookId) dari dramabox.com (wajib).
 * @param {string} query.chapter - ID episode (chapterId) dari dramabox.com (wajib).
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
 * fetch('https://puruboy-api.vercel.app/api/dramabox/stream?id=41000105764&chapter=578668219')
 *     .then(res => res.json())
 *     .then(console.log);
 */
import { NextResponse } from 'next/server';
import { fetchDramaboxStream, DRAMABOX_LOCALES } from '../../../../lib/dramabox.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

function validateId(id, label) {
  if (!id || typeof id !== 'string' || !/^\d+$/.test(id)) {
    return `Parameter ${label} wajib berupa angka`;
  }
  if (id.length > 20) return `Parameter ${label} terlalu panjang`;
  return null;
}

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  const chapter = searchParams.get('chapter');
  const locale = searchParams.get('locale') || 'in';

  const invalidId = validateId(id, 'id');
  if (invalidId) return NextResponse.json({ error: invalidId }, { status: 400 });
  const invalidChapter = validateId(chapter, 'chapter');
  if (invalidChapter) return NextResponse.json({ error: invalidChapter }, { status: 400 });
  if (!DRAMABOX_LOCALES.includes(locale)) {
    return NextResponse.json(
      { error: `locale tidak didukung. Pilihan: ${DRAMABOX_LOCALES.join(', ')}` },
      { status: 400 }
    );
  }

  try {
    const data = await fetchDramaboxStream(id, chapter, locale);
    return NextResponse.json({ success: true, source: 'dramabox.com', ...data });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 502 });
  }
}

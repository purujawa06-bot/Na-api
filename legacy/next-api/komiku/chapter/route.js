/**
 * @title Komiku Chapter
 * @summary Reader chapter komik — daftar URL gambar dari komiku.org.
 * @description Mengambil daftar URL gambar satu chapter beserta info (id,
 *              series, nomor chapter, jumlah gambar, link series, prev/next
 *              chapter). Parameter url = permalink chapter usai domain, mis.
 *              "my-wife-waited-for-me-in-the-wheat-field-chapter-27".
 * @method GET
 * @path /api/komiku/chapter
 * @param {string} query.url - Permalink chapter (wajib, tanpa domain).
 * @response json
 * @example
 * fetch('https://puruboy-api.vercel.app/api/komiku/chapter?url=my-wife-waited-for-me-in-the-wheat-field-chapter-27')
 *     .then(res => res.json())
 *     .then(console.log);
 */
import { NextResponse } from 'next/server';
import { fetchKomikuChapter } from '../../../../lib/komiku.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const url = searchParams.get('url');

  if (!url || typeof url !== 'string' || !url.trim()) {
    return NextResponse.json({ error: 'Parameter url wajib diisi' }, { status: 400 });
  }
  if (url.length > 500) return NextResponse.json({ error: 'url terlalu panjang' }, { status: 400 });

  try {
    const data = await fetchKomikuChapter(url.trim());
    return NextResponse.json({ success: true, ...data });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 502 });
  }
}

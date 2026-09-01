/**
 * @title Komiku Home
 * @summary Beranda komiku.org — peringkat, populer, terbaru, baru ditambahkan.
 * @description Mengambil seksi beranda komiku.org: Peringkat Komiku (mingguan
 *              & harian), Komik Populer Update, Baca Komik Terbaru, dan Baru
 *              Ditambahkan. Informasi tiap komik mencakup judul, cover, tema,
 *              dan chapter terbaru. Tanpa browser — cukup HTTPS.
 * @method GET
 * @path /api/komiku/home
 * @response json
 * @example
 * fetch('https://puruboy-api.vercel.app/api/komiku/home')
 *     .then(res => res.json())
 *     .then(console.log);
 */
import { NextResponse } from 'next/server';
import { fetchKomikuHome } from '../../../../lib/komiku.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET() {
  try {
    const data = await fetchKomikuHome();
    return NextResponse.json({ success: true, ...data });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 502 });
  }
}

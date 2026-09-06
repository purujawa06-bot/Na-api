/**
 * @title PurTV Home
 * @summary Beranda purtv.vercel.app — slider unggulan, populer, terbaru, ongoing.
 * @description Mengambil data halaman beranda donghua sumber PurTV (anichin.cafe):
 *              featured slider, populer hari ini, rilis terbaru, ongoing sidebar,
 *              dan rekomendasi per genre. Tanpa browser — cukup HTTPS.
 * @method GET
 * @path /api/purtv/home
 * @response json
 * @example
 * fetch('https://puruboy-api.vercel.app/api/purtv/home')
 *     .then(res => res.json())
 *     .then(console.log);
 */
import { NextResponse } from 'next/server';
import { fetchPurtvHome } from '../../../../lib/purtv.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET() {
  try {
    const data = await fetchPurtvHome();
    return NextResponse.json({ success: true, ...data });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 502 });
  }
}
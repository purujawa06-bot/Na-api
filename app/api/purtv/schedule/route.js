/**
 * @title PurTV Jadwal
 * @summary Jadwal rilis donghua per hari.
 * @description Mengambil jadwal rilis mingguan donghua dari sumber PurTV
 *              (anichin.cafe /schedule/) — dikelompokkan per hari (Senin-Minggu)
 *              dengan jam rilis & episode berikutnya. Menyertakan `purtv_pagenation`.
 * @method GET
 * @path /api/purtv/schedule
 * @response json
 * @example
 * fetch('https://puruboy-api.vercel.app/api/purtv/schedule')
 *     .then(res => res.json())
 *     .then(console.log);
 */
import { NextResponse } from 'next/server';
import { fetchPurtvSchedule } from '../../../../lib/purtv.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET() {
  try {
    const data = await fetchPurtvSchedule();
    return NextResponse.json({ success: true, ...data });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 502 });
  }
}
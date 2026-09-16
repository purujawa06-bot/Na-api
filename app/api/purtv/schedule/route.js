/**
 * @title PurTV Jadwal
 * @summary Jadwal rilis donghua per hari.
 * @description Sumber baru anichin.com.co tidak menyediakan halaman jadwal,
 *              jadi endpoint mengembalikan daftar kosong + note (HTTP 200,
 *              bukan error) agar frontend tetap jalan.
 *              Menyertakan `purtv_pagenation`.
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

/**
 * @title Samehadaku Jadwal
 * @summary Jadwal rilis anime harian
 * @description Mengambil jadwal rilis anime berdasarkan hari (monday-sunday atau senin-minggu).
 *
 * @method GET
 * @path /api/samehadaku/jadwal
 *
 * @param {string} query.day - Nama hari (wajib, contoh: "monday" atau "senin")
 *
 * @response json
 * @example fetch('https://puruboy-api.vercel.app/api/samehadaku/jadwal?day=monday')
 */
import { NextResponse } from 'next/server';
import { fetchSamehadakuJadwal } from '../../../../lib/samehadaku.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

const VALID_DAYS = new Set([
    'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
    'senin', 'selasa', 'rabu', 'kamis', 'jumat', 'sabtu', 'minggu',
]);

export async function GET(req) {
    const { searchParams } = new URL(req.url);
    const day = searchParams.get('day');

    if (!day || typeof day !== 'string' || !day.trim()) {
        return NextResponse.json({ error: 'Parameter day wajib diisi' }, { status: 400 });
    }

    if (!VALID_DAYS.has(day.toLowerCase().trim())) {
        return NextResponse.json({ error: 'Parameter day tidak valid (gunakan nama hari Inggris atau Indonesia)' }, { status: 400 });
    }

    try {
        const data = await fetchSamehadakuJadwal(day.trim());
        return NextResponse.json({ success: true, ...data });
    } catch (error) {
        return NextResponse.json({ success: false, error: error.message }, { status: 502 });
    }
}

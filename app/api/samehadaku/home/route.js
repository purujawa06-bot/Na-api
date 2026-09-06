/**
 * @title Samehadaku Home
 * @summary Latest anime episodes from samehadaku
 * @description Mengambil daftar episode anime terbaru dari samehadaku.how. Menampilkan homepage berisi episode terbaru.
 *
 * @method GET
 * @path /api/samehadaku/home
 *
 * @response json
 * @example fetch('https://puruboy-api.vercel.app/api/samehadaku/home')
 */
import { NextResponse } from 'next/server';
import { fetchSamehadakuHome } from '../../../../lib/samehadaku.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET() {
    try {
        const data = await fetchSamehadakuHome();
        return NextResponse.json({ success: true, ...data });
    } catch (error) {
        return NextResponse.json({ success: false, error: error.message }, { status: 502 });
    }
}

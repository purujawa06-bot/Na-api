/**
 * @title Samehadaku Daftar Anime
 * @summary Daftar lengkap anime di samehadaku
 * @description Mengambil daftar anime lengkap dari samehadaku dengan pagination.
 *
 * @method GET
 * @path /api/samehadaku/daftar
 *
 * @param {string} [query.page] - Nomor halaman (default: 1)
 *
 * @response json
 * @example fetch('https://puruboy-api.vercel.app/api/samehadaku/daftar?page=2')
 */
import { NextResponse } from 'next/server';
import { fetchSamehadakuDaftar } from '../../../../lib/samehadaku.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(req) {
    const { searchParams } = new URL(req.url);
    const pageRaw = searchParams.get('page');

    let page = 1;
    if (pageRaw) {
        if (!/^\d+$/.test(pageRaw)) {
            return NextResponse.json({ error: 'Parameter page harus berupa angka' }, { status: 400 });
        }
        page = parseInt(pageRaw, 10);
        if (page < 1 || page > 5000) {
            return NextResponse.json({ error: 'Parameter page di luar jangkauan (1-5000)' }, { status: 400 });
        }
    }

    try {
        const data = await fetchSamehadakuDaftar(page);
        return NextResponse.json({ success: true, ...data });
    } catch (error) {
        return NextResponse.json({ success: false, error: error.message }, { status: 502 });
    }
}

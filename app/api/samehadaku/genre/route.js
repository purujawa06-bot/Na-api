/**
 * @title Samehadaku Genre
 * @summary Daftar anime berdasarkan genre
 * @description Mengambil daftar anime yang difilter berdasarkan genre slug dengan pagination.
 *
 * @method GET
 * @path /api/samehadaku/genre
 *
 * @param {string} query.genre - Slug genre (wajib, contoh: "action")
 * @param {string} [query.page] - Nomor halaman (default: 1)
 *
 * @response json
 * @example fetch('https://puruboy-api.vercel.app/api/samehadaku/genre?genre=action')
 */
import { NextResponse } from 'next/server';
import { fetchSamehadakuGenre } from '../../../../lib/samehadaku.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(req) {
    const { searchParams } = new URL(req.url);
    const genre = searchParams.get('genre');
    const pageRaw = searchParams.get('page');

    if (!genre || typeof genre !== 'string' || !genre.trim()) {
        return NextResponse.json({ error: 'Parameter genre wajib diisi' }, { status: 400 });
    }

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
        const data = await fetchSamehadakuGenre(genre.trim(), page);
        return NextResponse.json({ success: true, ...data });
    } catch (error) {
        return NextResponse.json({ success: false, error: error.message }, { status: 502 });
    }
}

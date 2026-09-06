/**
 * @title Samehadaku Search
 * @summary Search anime on samehadaku
 * @description Mencari anime berdasarkan judul menggunakan REST API samehadaku.
 *
 * @method GET
 * @path /api/samehadaku/search
 *
 * @param {string} query.q - Kata kunci pencarian (wajib)
 *
 * @response json
 * @example fetch('https://puruboy-api.vercel.app/api/samehadaku/search?q=naruto')
 */
import { NextResponse } from 'next/server';
import { fetchSamehadakuSearch } from '../../../../lib/samehadaku.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(req) {
    const { searchParams } = new URL(req.url);
    const q = searchParams.get('q');

    if (!q || typeof q !== 'string' || !q.trim()) {
        return NextResponse.json({ error: 'Parameter q (kata kunci) wajib diisi' }, { status: 400 });
    }

    try {
        const data = await fetchSamehadakuSearch(q.trim());
        return NextResponse.json({ success: true, ...data });
    } catch (error) {
        return NextResponse.json({ success: false, error: error.message }, { status: 502 });
    }
}

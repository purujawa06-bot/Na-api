/**
 * @title Samehadaku Detail
 * @summary Detail anime di samehadaku
 * @description Mengambil detail anime berdasarkan slug, mencakup sinopsis, rating, genre, dan daftar episode.
 *
 * @method GET
 * @path /api/samehadaku/detail
 *
 * @param {string} query.slug - Slug anime (wajib, contoh: "ao-no-hako")
 *
 * @response json
 * @example fetch('https://puruboy-api.vercel.app/api/samehadaku/detail?slug=ao-no-hako')
 */
import { NextResponse } from 'next/server';
import { fetchSamehadakuDetail } from '../../../../lib/samehadaku.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(req) {
    const { searchParams } = new URL(req.url);
    const slug = searchParams.get('slug');

    if (!slug || typeof slug !== 'string' || !slug.trim()) {
        return NextResponse.json({ error: 'Parameter slug wajib diisi' }, { status: 400 });
    }

    try {
        const data = await fetchSamehadakuDetail(slug.trim());
        return NextResponse.json({ success: true, ...data });
    } catch (error) {
        return NextResponse.json({ success: false, error: error.message }, { status: 502 });
    }
}

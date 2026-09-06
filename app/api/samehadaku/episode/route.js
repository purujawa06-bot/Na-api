/**
 * @title Samehadaku Episode
 * @summary Halaman episode anime di samehadaku
 * @description Mengambil data episode anime termasuk server player, link download, dan navigasi prev/next.
 *
 * @method GET
 * @path /api/samehadaku/episode
 *
 * @param {string} query.slug - Slug episode (wajib, contoh: "black-torch-episode-1")
 *
 * @response json
 * @example fetch('https://puruboy-api.vercel.app/api/samehadaku/episode?slug=black-torch-episode-1')
 */
import { NextResponse } from 'next/server';
import { fetchSamehadakuEpisode } from '../../../../lib/samehadaku.js';

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
        const data = await fetchSamehadakuEpisode(slug.trim());
        return NextResponse.json({ success: true, ...data });
    } catch (error) {
        return NextResponse.json({ success: false, error: error.message }, { status: 502 });
    }
}

/**
 * @title Samehadaku Player
 * @summary Data player AJAX episode
 * @description Mengambil HTML player untuk episode tertentu via AJAX POST ke samehadaku.
 *
 * @method GET
 * @path /api/samehadaku/player
 *
 * @param {string} query.post - ID post (wajib)
 * @param {string} query.nume - Nomor server (wajib)
 * @param {string} query.type - Tipe player (wajib)
 *
 * @response json
 * @example fetch('https://puruboy-api.vercel.app/api/samehadaku/player?post=123&nume=1&type=1')
 */
import { NextResponse } from 'next/server';
import { fetchSamehadakuPlayer } from '../../../../lib/samehadaku.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(req) {
    const { searchParams } = new URL(req.url);
    const post = searchParams.get('post');
    const nume = searchParams.get('nume');
    const type = searchParams.get('type');

    if (!post || !nume || !type) {
        return NextResponse.json({ error: 'Parameter post, nume, type wajib diisi' }, { status: 400 });
    }

    try {
        const data = await fetchSamehadakuPlayer(post, nume, type);
        return NextResponse.json({ success: true, ...data });
    } catch (error) {
        return NextResponse.json({ success: false, error: error.message }, { status: 502 });
    }
}

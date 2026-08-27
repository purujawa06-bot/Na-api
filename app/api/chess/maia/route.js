import { NextResponse } from 'next/server';
import { reportError } from '../../../../lib/errorLogger';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

/**
 * @title Maiachess Move Proxy
 * @summary Proxy request ke Maiachess API untuk dapatkan langkah dari Maia engine
 * @method POST
 * @path /api/chess/maia
 * @param {string} maia_name - Nama model Maia (default: maia_kdd_2200)
 * @param {number} initial_clock - Waktu awal detik (default: 0)
 * @param {number} current_clock - Waktu saat ini detik (default: 0)
 * @param {string} maia_version - Versi Maia (default: maia3)
 * @example
 * POST /api/chess/maia?maia_name=maia_kdd_2200&initial_clock=0&current_clock=0&maia_version=maia3
 * Body: ["f2f3","e7e6","e2e4"]
 * Returns: { move: "g8f6", ... }
 */
export async function POST(req) {
    try {
        const { searchParams } = new URL(req.url);
        const body = await req.json();

        if (!Array.isArray(body) || body.length === 0) {
            return NextResponse.json(
                { error: 'Body must be a non-empty array of moves' },
                { status: 400 }
            );
        }

        const maiaName = searchParams.get('maia_name') || 'maia_kdd_2200';
        const initialClock = searchParams.get('initial_clock') || '0';
        const currentClock = searchParams.get('current_clock') || '0';
        const maiaVersion = searchParams.get('maia_version') || 'maia3';

        const params = new URLSearchParams({
            maia_name: maiaName,
            initial_clock: initialClock,
            current_clock: currentClock,
            maia_version: maiaVersion,
        });

        const upstream = await fetch(
            `https://www.maiachess.com/api/v1/play/get_move?${params}`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                    'Origin': 'https://www.maiachess.com',
                    'Referer': 'https://www.maiachess.com/',
                },
                body: JSON.stringify(body),
            }
        );

        if (!upstream.ok) {
            const text = await upstream.text();
            return NextResponse.json(
                { error: `Upstream error ${upstream.status}`, detail: text },
                { status: upstream.status }
            );
        }

        const data = await upstream.json();
        return NextResponse.json(data);
    } catch (error) {
        reportError(error, { endpoint: '/api/chess/maia', method: 'POST' }).catch(() => {});
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

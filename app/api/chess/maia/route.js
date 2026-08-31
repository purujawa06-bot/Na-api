import { NextResponse } from 'next/server';
import { reportError } from '../../../../lib/errorLogger';
import { Chess } from 'chess.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

const pgnToUci = (pgn) => {
    const chess = new Chess();
    chess.loadPgn(pgn, { strict: false });
    return chess.history({ verbose: true }).map((m) => m.from + m.to + (m.promotion ? m.promotion : ''));
};

/**
 * @title Maia Chess Move Proxy
 * @summary Proxy request ke Maiachess API untuk mendapatkan langkah terbaik dari Maia Chess Engine.
 * @description Endpoint proxy ke Maiachess (www.maiachess.com) untuk mendapatkan saran langkah catur
 *              dari Maia neural network engine (model kdd 2200). Endpoint hanya menerima satu
 *              query parameter, yaitu "pgn" (Portable Game Notation). Query parameter selain "pgn"
 *              akan ditolak (400). Langkah UCI diekstrak dari PGN sebelum diteruskan ke Maiachess.
 *              Response berisi top_move dalam format UCI, move_delay, dan inference_time.
 *              Tidak memerlukan autentikasi, tapi rate limit berlaku.
 * @method GET
 * @path /api/chess/maia
 * @header Accept: application/json
 *
 * @param {string} query.pgn - String PGN yang merepresentasikan riwayat permainan catur.
 *                             Contoh: "1. e4 e6 2. Nf3".
 *                             Satu-satunya parameter yang diterima — model yang dipakai tetap
 *                             Maia KDD 2200 (tidak bisa diubah).
 *
 * @returns {Object} success - Response dari Maiachess
 * @returns {string} success.top_move - Langkah terbaik dalam format UCI (e.g. "d7d5")
 * @returns {number} success.move_delay - Delay gerakan dalam detik (0.0 jika instant)
 * @returns {number|null} success.inference_time - Waktu inferensi neural network dalam detik (null jika tidak tersedia)
 *
 * @error {string} error.error - Deskripsi error
 * @error {string} [error.detail] - Detail error dari upstream Maiachess
 *
 * @example Request — Maia KDD 2200
 * fetch('https://puruboy-api.vercel.app/api/chess/maia?pgn=1.%20e4%20e6%202.%20Nf3')
 *     .then(res => res.json())
 *     .then(console.log);
 * // { top_move: "d7d5", move_delay: 0.0, inference_time: null }
 */
export async function GET(req) {
    try {
        const allowed = ['pgn'];
        const params = [...req.nextUrl.searchParams.keys()];
        const unexpected = params.filter((k) => !allowed.includes(k));

        if (unexpected.length > 0) {
            return NextResponse.json(
                { error: `Query parameter "${unexpected[0]}" is not allowed. Only "pgn" is accepted.` },
                { status: 400 }
            );
        }

        const pgn = req.nextUrl.searchParams.get('pgn');

        if (!pgn) {
            return NextResponse.json(
                { error: 'Query parameter "pgn" is required' },
                { status: 400 }
            );
        }

        let notasi;
        try {
            notasi = pgnToUci(pgn);
        } catch {
            return NextResponse.json(
                { error: 'Invalid PGN string' },
                { status: 400 }
            );
        }

        if (!notasi || notasi.length === 0) {
            return NextResponse.json(
                { error: 'Invalid PGN: no moves found' },
                { status: 400 }
            );
        }

        const upstreamParams = new URLSearchParams({
            maia_name: 'maia_kdd_2200',
            initial_clock: '0',
            current_clock: '0',
            maia_version: 'maia3',
        });

        const upstream = await fetch(
            `https://www.maiachess.com/api/v1/play/get_move?${upstreamParams}`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                    'Origin': 'https://www.maiachess.com',
                    'Referer': 'https://www.maiachess.com/',
                },
                body: JSON.stringify(notasi),
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
        reportError(error, { endpoint: '/api/chess/maia', method: 'GET' }).catch(() => {});
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
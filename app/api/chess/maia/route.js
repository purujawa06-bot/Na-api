import { NextResponse } from 'next/server';
import { reportError } from '../../../../lib/errorLogger';
import { Chess } from 'chess.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

const fenPieces = (fen) => {
    const rows = fen.split(' ')[0].split('/');
    const arr = new Array(64).fill('');
    for (let ri = 0; ri < 8; ri++) {
        const erank = 7 - ri;
        let f = 0;
        for (const ch of rows[ri]) {
            if (ch >= '0' && ch <= '9') f += parseInt(ch, 10);
            else { arr[erank * 8 + f] = ch; f++; }
        }
    }
    return arr;
};

const boardArr = (board) => {
    const arr = new Array(64).fill('');
    for (let r = 0; r < 8; r++) {
        for (let f = 0; f < 8; f++) {
            const sq = board[r][f];
            if (sq) arr[(7 - r) * 8 + f] = sq.color === 'w' ? sq.type.toUpperCase() : sq.type;
        }
    }
    return arr;
};

const compatibleScore = (cur, target) => {
    let score = 0;
    for (let i = 0; i < 64; i++) {
        if (target[i] === '') continue;
        if (cur[i] === target[i]) score++;
        else if (cur[i] !== '' && cur[i] !== target[i]) return -1;
    }
    return score;
};

// Rekonstruksi riwayat langkah UCI dari FEN posisi akhir (greedy).
// Pola nya sama dengan reconstructMoves di userscript maia-chess.
const reconstructUci = (fen) => {
    const target = fenPieces(fen);
    const chess = new Chess();
    const uci = [];
    let guard = 0;
    while (guard++ < 300) {
        const cur = boardArr(chess.board());
        if (cur.every((p, i) => p === target[i])) return uci;
        const moves = chess.moves({ verbose: true });
        let bestUci = null;
        let bestScore = -1;
        for (const m of moves) {
            chess.move(m);
            const sc = compatibleScore(boardArr(chess.board()), target);
            chess.undo();
            if (sc < 0) continue;
            if (sc > bestScore) {
                bestScore = sc;
                bestUci = m.from + m.to + (m.promotion ? m.promotion : '');
            }
        }
        if (!bestUci) return null;
        chess.move({
            from: bestUci.slice(0, 2),
            to: bestUci.slice(2, 4),
            promotion: bestUci.length > 4 ? bestUci[4] : undefined,
        });
        uci.push(bestUci);
    }
    return null;
};

/**
 * @title Maia Chess Move Proxy
 * @summary Proxy request ke Maiachess API untuk mendapatkan langkah terbaik dari Maia Chess Engine.
 * @description Endpoint proxy ke Maiachess (www.maiachess.com) untuk mendapatkan saran langkah catur
 *              dari Maia neural network engine (model kdd 2200). Endpoint hanya menerima satu
 *              query parameter, yaitu "fen" (standar FEN notation). Query parameter selain "fen"
 *              akan ditolak (400). Riwayat langkah UCI direkonstruksi dari FEN sebelum diteruskan
 *              ke Maiachess. Response berisi top_move dalam format UCI, move_delay, dan
 *              inference_time. Tidak memerlukan autentikasi, tapi rate limit berlaku.
 * @method GET
 * @path /api/chess/maia
 * @header Accept: application/json
 *
 * @param {string} query.fen - String FEN standar yang merepresentasikan posisi papan catur.
 *                             Contoh: "rnbqkbnr/pppp1ppp/4p3/8/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 1 2".
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
 * fetch('https://puruboy-api.vercel.app/api/chess/maia?fen=rnbqkbnr/pppp1ppp/4p3/8/4P3/5N2/PPPP1PPP/RNBQKB1R%20b%20KQkq%20-%201%202')
 *     .then(res => res.json())
 *     .then(console.log);
 * // { top_move: "d7d5", move_delay: 0.0, inference_time: null }
 */
export async function GET(req) {
    try {
        const allowed = ['fen'];
        const params = [...req.nextUrl.searchParams.keys()];
        const unexpected = params.filter((k) => !allowed.includes(k));

        if (unexpected.length > 0) {
            return NextResponse.json(
                { error: `Query parameter "${unexpected[0]}" is not allowed. Only "fen" is accepted.` },
                { status: 400 }
            );
        }

        const fen = req.nextUrl.searchParams.get('fen');

        if (!fen) {
            return NextResponse.json(
                { error: 'Query parameter "fen" is required' },
                { status: 400 }
            );
        }

        try {
            new Chess(fen);
        } catch {
            return NextResponse.json(
                { error: 'Invalid FEN string' },
                { status: 400 }
            );
        }

        const notasi = reconstructUci(fen);

        if (!notasi || notasi.length === 0) {
            return NextResponse.json(
                { error: 'Invalid FEN: no moves found' },
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
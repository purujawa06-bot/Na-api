import { NextResponse } from 'next/server';
import { reportError } from '../../../../lib/errorLogger';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

/**
 * @title Maia Chess Move Proxy
 * @summary Proxy request ke Maiachess API untuk mendapatkan langkah terbaik dari Maia Chess Engine.
 * @description Endpoint proxy ke Maiachess (www.maiachess.com) untuk mendapatkan saran langkah catur
 *              dari Maia neural network engine (model kdd 2200). Endpoint hanya menerima satu parameter,
 *              yaitu `notasi` (array langkah UCI). Response berisi top_move dalam format UCI,
 *              move_delay, dan inference_time. Tidak memerlukan autentikasi, tapi rate limit berlaku.
 * @method POST
 * @path /api/chess/maia
 * @header Content-Type: application/json
 * @header Accept: application/json
 *
 * @param {string[]} body.notasi - Array gerakan dalam format UCI (e.g. ["e2e4", "e7e5", "g1f3"]).
 *                                 Representasi langkah dari awal permainan secara berurutan.
 *                                 Format UCI: "kotak_awal + kotak_tujuan" (e.g. e2e4 = pawn e2 ke e4).
 *                                 Endpoint ini hanya menerima satu param ini — model yang dipakai
 *                                 tetap Maia KDD 2200 (tidak bisa diubah).
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
 * fetch('https://puruboy.kozow.com/api/chess/maia', {
 *     method: 'POST',
 *     headers: { 'Content-Type': 'application/json' },
 *     body: JSON.stringify({ notasi: ["f2f3", "e7e6", "e2e4"] })
 * }).then(res => res.json()).then(console.log);
 * // { top_move: "d7d5", move_delay: 0.0, inference_time: null }
 */
export async function POST(req) {
    try {
        const { notasi } = await req.json();

        if (!Array.isArray(notasi) || notasi.length === 0) {
            return NextResponse.json(
                { error: 'Body must be a non-empty array in the "notasi" field' },
                { status: 400 }
            );
        }

        const params = new URLSearchParams({
            maia_name: 'maia_kdd_2200',
            initial_clock: '0',
            current_clock: '0',
            maia_version: 'maia3',
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
        reportError(error, { endpoint: '/api/chess/maia', method: 'POST' }).catch(() => {});
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

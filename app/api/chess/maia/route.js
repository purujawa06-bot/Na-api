import { NextResponse } from 'next/server';
import { reportError } from '../../../../lib/errorLogger';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

/**
 * @title Maiachess Move Proxy
 * @summary Proxy request ke Maiachess API untuk mendapatkan langkah terbaik dari Maia Chess Engine.
 * @description Endpoint proxy ke Maiachess (www.maiachess.com) untuk mendapatkan saran langkah catur
 *              dari Maia neural network engine. Mendukung berbagai model Maia (kdd 1200-2200, leela)
 *              dan versi Maia (maia1-maia5). Response berisi top_move dalam format UCI,
 *              move_delay, dan inference_time. Tidak memerlukan autentikasi, tapi rate limit berlaku.
 * @method POST
 * @path /api/chess/maia
 * @header Content-Type: application/json
 * @header Accept: application/json
 *
 * @param {string} [query.maia_name] - Nama model Maia yang digunakan (menentukan tingkat kesulitan).
 *        @choice maia_kdd_1100 - Maia 1100 (Sangat Mudah)
 *        @choice maia_kdd_1200 - Maia 1200
 *        @choice maia_kdd_1300 - Maia 1300
 *        @choice maia_kdd_1400 - Maia 1400
 *        @choice maia_kdd_1500 - Maia 1500
 *        @choice maia_kdd_1600 - Maia 1600
 *        @choice maia_kdd_1700 - Maia 1700
 *        @choice maia_kdd_1800 - Maia 1800
 *        @choice maia_kdd_1900 - Maia 1900
 *        @choice maia_kdd_2200 - Maia 2200 (Paling Kuat)
 *        @choice maia_leela - Maia Leela (Hybrid)
 * @param {number} [query.initial_clock] - Waktu jam awal permainan dalam detik.
 *        @choice 0 - Unlimited / Blitz
 *        @choice 60 - 1 Minute (Bullet)
 *        @choice 180 - 3 Minutes (Blitz)
 *        @choice 300 - 5 Minutes (Blitz)
 *        @choice 600 - 10 Minutes (Rapid)
 * @param {number} [query.current_clock] - Waktu jam tersisa pemain saat ini dalam detik. 0 = unlimited.
 * @param {string} [query.maia_version] - Versi Maia engine yang dipakai.
 *        @choice maia1 - Version 1 (Old)
 *        @choice maia2 - Version 2
 *        @choice maia3 - Version 3 (Default)
 *        @choice maia4 - Version 4
 *        @choice maia5 - Version 5 (Latest)
 *
 * @param {string[]} body.notation - Array gerakan dalam format UCI (e.g. ["e2e4", "e7e5", "g1f3"]).
 *                           Representasi langkah dari awal permainan secara berurutan.
 *                           Format UCI: "kotak_awal + kotak_tujuan" (e.g. e2e4 = pawn e2 ke e4).
 *                           NOTE: Body adalah array langsung, bukan objek — field ini
 *                           hanya untuk menampilkan label input "notation" pada docs.
 *
 * @returns {Object} success - Response dari Maiachess
 * @returns {string} success.top_move - Langkah terbaik dalam format UCI (e.g. "d7d5")
 * @returns {number} success.move_delay - Delay gerakan dalam detik (0.0 jika instant)
 * @returns {number|null} success.inference_time - Waktu inferensi neural network dalam detik (null jika tidak tersedia)
 *
 * @error {string} error.error - Deskripsi error
 * @error {string} [error.detail] - Detail error dari upstream Maiachess
 *
 * @example Default request — Maia KDD 2200
 * // NOTE: Endpoint ini menerima array langsung sebagai body.
 * fetch('https://puruboy.kozow.com/api/chess/maia', {
 *     method: 'POST',
 *     headers: { 'Content-Type': 'application/json' },
 *     body: JSON.stringify(["f2f3", "e7e6", "e2e4"])
 * }).then(res => res.json()).then(console.log);
 * // { top_move: "d7d5", move_delay: 0.0, inference_time: null }
 *
 * @example Model Maia KDD 1500 — untuk level pemula
 * fetch('https://puruboy.kozow.com/api/chess/maia?maia_name=maia_kdd_1500', {
 *     method: 'POST',
 *     headers: { 'Content-Type': 'application/json' },
 *     body: JSON.stringify(["e2e4", "e7e5", "g1f3"])
 * }).then(res => res.json()).then(console.log);
 * // { top_move: "b8c6", move_delay: 0, inference_time: null }
 *
 * @example Custom clock — 10 menit awal, 5 menit tersisa
 * fetch('https://puruboy.kozow.com/api/chess/maia?initial_clock=600&current_clock=300', {
 *     method: 'POST',
 *     headers: { 'Content-Type': 'application/json' },
 *     body: JSON.stringify(["d2d4", "d7d5", "c2c4"])
 * }).then(res => res.json()).then(console.log);
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

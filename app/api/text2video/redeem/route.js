/**
 * @title AI Text-to-Video (Raphael) — Tukar Tiket
 * @summary Langkah 2: tukar ticket menjadi job_id via raphael.app setelah wait_ms habis.
 * @description GET /api/text2video/redeem menukar `ticket` (dari POST /api/text2video)
 *              menjadi `job_id` setelah masa antre `wait_ms` habis. Kalau terlalu
 *              cepat, balas 409 `QUEUE_NOT_READY` + sisa `wait_ms` — tunggu lalu
 *              ulangi. Lanjut poll GET /api/text2video/status sampai complete.
 * @method GET
 * @path /api/text2video/redeem
 * @param {string} query.ticket - Tiket antre dari POST /api/text2video (wajib).
 * @param {string} query.cookie - Cookie identitas dari POST /api/text2video (wajib).
 * @response json
 * @example
 * fetch('https://puruboy-api.vercel.app/api/text2video/redeem?ticket=TIKET_ANDA&cookie=COOKIE_ANDA')
 *     .then(res => res.json())
 *     .then(console.log);
 */
import { NextResponse } from 'next/server';
import { redeemTicket } from '../../../../lib/raphael-text2video.js';
import { reportError } from '../../../../lib/errorLogger';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const ticket = (searchParams.get('ticket') || '').trim();
  const cookie = (searchParams.get('cookie') || '').trim();

  if (!ticket) {
    return NextResponse.json({ success: false, error: 'Parameter ticket wajib diisi' }, { status: 400 });
  }
  if (!cookie) {
    return NextResponse.json({ success: false, error: 'Parameter cookie wajib diisi' }, { status: 400 });
  }

  try {
    const r = await redeemTicket({ ticket, cookie });
    const statusUrl = `/api/text2video/status?job_id=${encodeURIComponent(r.job_id)}&cookie=${encodeURIComponent(cookie)}`;
    return NextResponse.json(
      {
        success: true,
        status: 'submitted',
        source: 'raphael',
        job_id: r.job_id,
        status_url: statusUrl,
        hint: 'Poll GET status_url sampai status complete (videoUrl)',
      },
      {
        headers: {
          'cache-control': 'no-store, no-cache, must-revalidate',
          pragma: 'no-cache',
          'x-cache': 'BYPASS',
        },
      }
    );
  } catch (err) {
    reportError(err, { endpoint: '/api/text2video/redeem', method: 'GET' }).catch(() => {});
    if (err?.status === 409) {
      const waitMs = Number(err.wait_ms) || 15000;
      return NextResponse.json(
        {
          success: false,
          status: 'queued',
          error: 'Antrean belum siap (QUEUE_NOT_READY), coba lagi setelah wait_ms',
          wait_ms: waitMs,
          wait_seconds: Math.ceil(waitMs / 1000),
        },
        { status: 409 }
      );
    }
    const status = err?.status === 400 || err?.status === 404 || err?.status === 429 ? err.status : 502;
    return NextResponse.json({ success: false, error: err.message || 'Gagal menukar tiket' }, { status });
  }
}

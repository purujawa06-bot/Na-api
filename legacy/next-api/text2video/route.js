/**
 * @title AI Text-to-Video (Raphael) — Minta Tiket
 * @summary Generate video dari teks via raphael.app (MiniMax H3 Turbo, gratis anonim). Langkah 1: minta tiket antre.
 * @description POST /api/text2video meminta tiket antre ke Raphael (model gratis
 *              terkunci: MiniMax H3 Turbo 480P ~4 detik). Respons langsung berisi
 *              `ticket`, `wait_ms`, dan `cookie` (<5 detik, aman di timeout Hobby).
 *              Lanjut ke GET /api/text2video/redeem setelah wait_ms, lalu poll
 *              GET /api/text2video/status sampai `status: complete` (videoUrl).
 * @method POST
 * @path /api/text2video
 * @param {string} body.prompt - Deskripsi video (wajib, 1-2000 karakter).
 * @param {string} [body.aspect] - Rasio aspek video. Default: '16:9'.
 *        @choice 16:9 - Landscape 16:9 (YouTube)
 *        @choice 9:16 - Vertikal 9:16 (TikTok/Reels/Shorts)
 *        @choice 1:1 - Persegi 1:1 (feed)
 *        @choice 4:3 - Klasik 4:3
 *        @choice 3:4 - Potrait 3:4
 *        @choice 21:9 - Ultrawide 21:9
 * @response json
 * @example
 * fetch('https://puruboy-api.vercel.app/api/text2video', {
 *     method: 'POST',
 *     headers: { 'Content-Type': 'application/json' },
 *     body: JSON.stringify({ prompt: 'a fox in snowy forest cinematic', aspect: '16:9' })
 * }).then(res => res.json()).then(console.log);
 */
import { NextResponse } from 'next/server';
import { requestTicket, VIDEO_ASPECTS, VIDEO_MODEL } from '../../../lib/raphael-text2video.js';
import { reportError } from '../../../lib/errorLogger';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req) {
  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Body JSON tidak valid' }, { status: 400 });
  }

  const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
  if (!prompt) {
    return NextResponse.json({ success: false, error: 'Parameter prompt wajib diisi' }, { status: 400 });
  }
  if (prompt.length > 2000) {
    return NextResponse.json(
      { success: false, error: 'Parameter prompt terlalu panjang (maks 2000 karakter)' },
      { status: 400 }
    );
  }

  let aspect = typeof body.aspect === 'string' ? body.aspect.trim() : '16:9';
  if (!VIDEO_ASPECTS.includes(aspect)) {
    return NextResponse.json(
      { success: false, error: `Parameter aspect tidak valid. Pilihan: ${VIDEO_ASPECTS.join(', ')}` },
      { status: 400 }
    );
  }

  try {
    const t = await requestTicket({ prompt, aspect });
    return NextResponse.json(
      {
        success: true,
        status: 'queued',
        source: 'raphael',
        model: VIDEO_MODEL,
        ticket: t.ticket,
        wait_ms: t.wait_ms,
        wait_seconds: Math.ceil(t.wait_ms / 1000),
        cookie: t.cookie,
        aspect: t.aspect,
        next: {
          redeem_after_ms: t.wait_ms,
          redeem_url: `/api/text2video/redeem?ticket=${encodeURIComponent(t.ticket)}&cookie=${encodeURIComponent(t.cookie)}`,
          hint: 'Tunggu wait_ms lalu GET redeem_url untuk dapat job_id',
        },
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
    reportError(err, { endpoint: '/api/text2video', method: 'POST' }).catch(() => {});
    const status = err?.status === 400 || err?.status === 429 ? err.status : 502;
    return NextResponse.json({ success: false, error: err.message || 'Gagal meminta tiket video' }, { status });
  }
}

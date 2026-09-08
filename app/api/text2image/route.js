/**
 * @title AI Text-to-Image (Vheer)
 * @summary Generate gambar dari teks (model gratis Flux), tanpa login.
 * @description Membuat gambar dari prompt teks via layanan vheer.com
 *              (reverse-engineered, pure-HTTP). Menjalankan moderasi konten
 *              otomatis. Proses generasi bisa memakan waktu > 60 detik,
 *              sehingga di-offload ke Background HTTP Job proxy
 *              (https://nirkyy-a.hf.space/) agar tidak kena timeout
 *              serverless Vercel.
 *
 *              Alur:
 *              1. POST /api/text2image -> langsung balas 202 + job_id
 *              2. GET /api/text2image/{job_id} -> cek status sampai selesai
 *
 * @method POST
 * @path /api/text2image
 * @param {string} body.prompt - Deskripsi gambar yang ingin dibuat (wajib).
 * @param {string} [body.size] - Rasio aspek gambar.
 *        @choice 1:1 - Persegi (Default)
 *        @choice 16:9 - Landscape
 *        @choice 9:16 - Portrait
 *        @choice auto - Menyesuaikan prompt
 * @param {number} [body.num_images] - Jumlah gambar (default 1, maks 4).
 * @response json (202 Accepted)
 * @example Membuat gambar (async)
 * fetch('https://puruboy-api.vercel.app/api/text2image', {
 *     method: 'POST',
 *     headers: { 'Content-Type': 'application/json' },
 *     body: JSON.stringify({ prompt: 'seekor rubah merah di hutan salju', size: '1:1', num_images: 1 })
 * }).then(res => res.json()).then(console.log);
 * // => { success: true, job_id: 't2i-xxxx', status_url: '/api/text2image/xxxx' }
 */
import { NextResponse } from 'next/server';
import { createProxyJob } from '../../../lib/vheer-proxy.js';
import { reportError } from '../../../lib/errorLogger';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

const SIZES = ['1:1', '16:9', '9:16', 'auto'];
const JOB_PREFIX = 't2i-';

// Base URL publik untuk memanggil worker (dari sisi proxy HF Space).
// Selalu hardcode production URL — preview deployment diproteksi Vercel Auth.
function getPublicBase() {
  return 'https://puruboy-api.vercel.app';
}

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

  let size = typeof body.size === 'string' ? body.size.trim() : '1:1';
  if (!SIZES.includes(size)) {
    return NextResponse.json({ success: false, error: 'Parameter size tidak valid. Pilihan: 1:1, 16:9, 9:16, auto' }, { status: 400 });
  }

  let numImages = body.num_images;
  if (numImages !== undefined) numImages = Number(numImages);
  if (!Number.isFinite(numImages) || numImages < 1) numImages = 1;
  if (numImages > 4) numImages = 4;

  // Job id deterministic: t2i-<timestamp>-<random> (unik per request)
  const jobId = `${JOB_PREFIX}${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

  const workerUrl = `${getPublicBase()}/api/text2image/worker`;
  const workerSecret = process.env.PURUBOY_ADMIN_KEY || '';

  try {
    // Jalankan worker di background via proxy. Worker yang melakukan polling
    // vheer sampai selesai (bisa > 60 detik) — di luar timeout Vercel.
    await createProxyJob(jobId, {
      method: 'post',
      targetUrl: workerUrl,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${workerSecret}` },
      body: { prompt, size, num_images: numImages },
    });

    return NextResponse.json(
      {
        success: true,
        message: 'Job diterima, silakan polling status.',
        job_id: jobId,
        status_url: `/api/text2image/${jobId}`,
      },
      { status: 202 }
    );
  } catch (err) {
    reportError(err, { endpoint: '/api/text2image', method: 'POST' }).catch(() => {});
    return NextResponse.json({ success: false, error: err.message || 'Gagal membuat job' }, { status: 502 });
  }
}
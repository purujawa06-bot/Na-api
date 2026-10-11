/**
 * @title AI Text-to-Video (Raphael) — Cek Status
 * @summary Langkah 3: poll status job video via raphael.app sampai complete (videoUrl).
 * @description GET /api/text2video/status mengecek status `job_id` (dari
 *              GET /api/text2video/redeem). Poll tiap ~10-20 detik (pakai
 *              `next_poll_ms` bila ada) sampai `status: complete` — hasilnya ada
 *              di `videos[]` (URL mp4 langsung) + `thumbnails[]`.
 * @method GET
 * @path /api/text2video/status
 * @param {string} query.job_id - Job ID dari GET /api/text2video/redeem (wajib).
 * @param {string} query.cookie - Cookie identitas dari POST /api/text2video (wajib).
 * @response json
 * @example
 * fetch('https://puruboy-api.vercel.app/api/text2video/status?job_id=JOB_ANDA&cookie=COOKIE_ANDA')
 *     .then(res => res.json())
 *     .then(console.log);
 */
import { NextResponse } from 'next/server';
import { getJobStatus } from '../../../../lib/raphael-text2video.js';
import { reportError } from '../../../../lib/errorLogger';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const jobId = (searchParams.get('job_id') || searchParams.get('jobId') || '').trim();
  const cookie = (searchParams.get('cookie') || '').trim();

  if (!jobId) {
    return NextResponse.json({ success: false, error: 'Parameter job_id wajib diisi' }, { status: 400 });
  }
  if (!cookie) {
    return NextResponse.json({ success: false, error: 'Parameter cookie wajib diisi' }, { status: 400 });
  }

  try {
    const s = await getJobStatus({ job_id: jobId, cookie });
    return NextResponse.json(
      {
        success: true,
        source: 'raphael',
        status: s.status,
        upstream_status: s.upstream_status,
        progress: s.progress,
        videos: s.videos,
        thumbnails: s.thumbnails,
        next_poll_ms: s.next_poll_ms,
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
    reportError(err, { endpoint: '/api/text2video/status', method: 'GET' }).catch(() => {});
    const status = err?.status === 400 || err?.status === 404 ? err.status : 502;
    return NextResponse.json({ success: false, error: err.message || 'Gagal cek status job' }, { status });
  }
}

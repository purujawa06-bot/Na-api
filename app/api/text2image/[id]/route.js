/**
 * @title Text-to-Image Status
 * @summary Cek status job generasi gambar.
 * @description Polling status job text-to-image yang dibuat via
 *              POST /api/text2image. Selama job masih diproses akan
 *              mengembalikan { status: 'processing' }. Setelah selesai
 *              mengembalikan { status: 'success', images: [...] }.
 *              Job tersimpan ±1 jam di proxy.
 * @method GET
 * @path /api/text2image/{job_id}
 * @response json
 * @example
 * fetch('https://puruboy-api.vercel.app/api/text2image/t2i-xxxx')
 *     .then(res => res.json())
 *     .then(console.log);
 */
import { NextResponse } from 'next/server';
import { getProxyJob, parseRawHttpResponse } from '../../../../lib/vheer-proxy.js';
import { reportError } from '../../../../lib/errorLogger';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(req, { params }) {
  const jobId = params?.id;
  if (!jobId) {
    return NextResponse.json({ success: false, error: 'Parameter job_id wajib diisi' }, { status: 400 });
  }

  try {
    const job = await getProxyJob(jobId);

    if (job.running) {
      return NextResponse.json({ success: true, status: 'processing', job_id: jobId });
    }

    if (job.status === 404) {
      return NextResponse.json(
        { success: false, status: 'expired', error: 'Job tidak ditemukan atau sudah kedaluwarsa (1 jam).' },
        { status: 404 }
      );
    }

    // Job selesai: raw HTTP response dari worker.
    const parsed = parseRawHttpResponse(job.body || job.raw || '');

    // Coba parse body JSON dari worker.
    let data = null;
    try {
      data = JSON.parse(parsed.body);
    } catch {
      data = null;
    }

    if (data && data.success) {
      return NextResponse.json({
        success: true,
        status: 'success',
        job_id: jobId,
        source: data.source || 'vheer',
        model: data.model,
        taskId: data.taskId,
        images: data.images || [],
      });
    }

    if (data && !data.success) {
      return NextResponse.json(
        {
          success: false,
          status: 'error',
          job_id: jobId,
          error: data.error || 'Generasi gagal',
          httpStatus: data.httpStatus || 502,
        },
        { status: data.httpStatus && data.httpStatus >= 400 && data.httpStatus < 600 ? data.httpStatus : 502 }
      );
    }

    // Body tidak ter-parse: tampilkan raw.
    return NextResponse.json(
      { success: false, status: 'error', job_id: jobId, error: 'Respons worker tidak valid', raw: parsed.body.slice(0, 500) },
      { status: 502 }
    );
  } catch (err) {
    reportError(err, { endpoint: '/api/text2image/:id', method: 'GET' }).catch(() => {});
    return NextResponse.json({ success: false, status: 'error', error: 'Terjadi kesalahan internal.' }, { status: 500 });
  }
}
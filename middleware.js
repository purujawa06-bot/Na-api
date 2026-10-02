/**
 * Middleware Global — Next.js 14 (Edge Runtime)
 *
 * Stamp cache-control + normalisasi error HTML ke JSON.
 * Tidak ada report ke Telegram — error cukup console.error.
 *
 * Runtime: Edge (otomatis oleh Next.js untuk middleware)
 */

import { NextResponse } from 'next/server';
import { EDGE_CACHE_CONTROL } from './lib/api-cache.js';

export async function middleware(request) {
    const url = request.nextUrl;
    const pathname = url.pathname;

    // No-exception policy: tidak lagi membatasi hanya /api/*.
    // Hapus semua early-return pembatas (temp/media/chess) supaya semua route
    // dapat stamp header. Skip method OPTIONS (CORS preflight) tetap.
    if (request.method === 'OPTIONS') {
        return;
    }

    // Baca body LENGKAP lalu bangun Request baru: meng-forward request asli
    // (streaming body) dari middleware merusak/terpotong body di runtime Next dev.
    let forwardRequest = request;
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) {
        try {
            const cloned = request.clone();
            const rawText = await cloned.text();
            if (rawText) {
                forwardRequest = new Request(request.url, {
                    method: request.method,
                    headers: request.headers,
                    body: rawText,
                    signal: request.signal,
                });
            }
        } catch (e) {
            // ignore — tetap forward request asli
        }
    }

    // Lanjutkan request ke handler.
    // fetch-forward dari middleware kadang gagal di runtime Next dev (fetch failed).
    // Jangan sampai memblokir API: kalau gagal, biarkan request jalan normal.
    let response;
    try {
        response = await fetch(forwardRequest);
    } catch (e) {
        console.error('[Middleware] fetch-forward gagal, lanjut tanpa middleware:', e.message);
        return NextResponse.next();
    }

    // No-exception policy: semua response, semua method, semua content-type
    // (JSON/gambar/SSE/NDJSON/POST/private) distamp dengan nilai yang sama.
    const stampCacheHeader = (res) => {
        const headers = new Headers(res.headers);
        headers.set('cache-control', EDGE_CACHE_CONTROL);
        headers.set('x-cache', 'EDGE-DEFAULT');
        return new Response(res.body, {
            status: res.status,
            statusText: res.statusText,
            headers,
        });
    };

    // Jika response OK (2xx), langsung stamp tanpa report
    if (response.status >= 200 && response.status < 300) {
        return stampCacheHeader(response);
    }

    // --- Non-200 response: cukup log ke console, tanpa kirim ke Telegram ---

    // Log ke console
    console.error(`[Middleware] Non-200: ${pathname} | ${request.method} | ${response.status}`);

    // 🎯 Jika response berupa HTML (default Next.js error page),
    //    konversi ke JSON biar API selalu konsisten
    const contentType = response.headers.get('content-type') || '';
    const isHtmlResponse = contentType.includes('text/html');
    if (isHtmlResponse) {
        const statusTextMap = {
            400: 'Bad Request',
            401: 'Unauthorized',
            403: 'Forbidden',
            404: 'Not Found',
            405: 'Method Not Allowed',
            406: 'Not Acceptable',
            408: 'Request Timeout',
            409: 'Conflict',
            410: 'Gone',
            411: 'Length Required',
            413: 'Payload Too Large',
            415: 'Unsupported Media Type',
            422: 'Unprocessable Entity',
            429: 'Too Many Requests',
            500: 'Internal Server Error',
            502: 'Bad Gateway',
            503: 'Service Unavailable',
            504: 'Gateway Timeout',
        };

        const hint = response.status === 405
            ? `This endpoint does not support ${request.method}. Check the documentation for supported methods.`
            : null;

        return stampCacheHeader(new Response(JSON.stringify({
            success: false,
            error: statusTextMap[response.status] || `HTTP ${response.status}`,
            ...(hint ? { hint } : {}),
            status: response.status,
        }), {
            status: response.status,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
            },
        }));
    }

    return stampCacheHeader(response);
}

// Semua route — tanpa pengecualian
export const config = {
    matcher: '/:path*',
};

/**
 * Middleware Global — Next.js 14 (Edge Runtime)
 *
 * Scope: /api/* saja (lihat matcher di bawah).
 * - Stamp cache-control hemat kuota (7 hari) untuk semua response API.
 * - Normalisasi error HTML default Next.js (404/500) ke JSON biar konsisten.
 * - Error cukup console.error — tanpa report ke Telegram.
 *
 * Sengaja TIDAK menyentuh pages (/, /docs, /chat, ...): fetch-forward manual
 * + stamp s-maxage pada HTML/RSC membuat client router menerima varian yang
 * salah (HTML penuh saat minta flight data) sehingga navigasi <Link> jatuh
 * ke reload full page. Pages biar pakai caching bawaan Next.js (ISR/static).
 *
 * Runtime: Edge (otomatis oleh Next.js untuk middleware)
 */

import { NextResponse } from 'next/server';
import { EDGE_CACHE_CONTROL } from './lib/api-cache.js';

export async function middleware(request) {
    if (request.method === 'OPTIONS') {
        return;
    }

    // Teruskan via pipeline normal Next.js — menjaga RSC/flight data,
    // streaming SSE, dan cookies tetap utuh. Jangan fetch-forward manual
    // + new Response(): itu yang merusak navigasi client-side.
    const response = await NextResponse.next();

    // Stamp hemat kuota — mutasi header langsung, body/streaming tak disentuh.
    response.headers.set('cache-control', EDGE_CACHE_CONTROL);
    response.headers.set('x-cache', 'EDGE-DEFAULT');

    if (response.status >= 200 && response.status < 300) {
        return response;
    }

    const pathname = request.nextUrl.pathname;
    console.error(`[Middleware] Non-200: ${pathname} | ${request.method} | ${response.status}`);

    // Normalisasi HTML error default Next.js ke JSON (khusus API).
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('text/html')) {
        return response;
    }

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

    return new Response(JSON.stringify({
        success: false,
        error: statusTextMap[response.status] || `HTTP ${response.status}`,
        ...(hint ? { hint } : {}),
        status: response.status,
    }), {
        status: response.status,
        headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'cache-control': EDGE_CACHE_CONTROL,
            'x-cache': 'EDGE-DEFAULT',
        },
    });
}

// API saja — pages (_next, /, /docs, ...) jangan disentuh middleware
export const config = {
    matcher: '/api/:path*',
};

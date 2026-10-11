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

/**
 * Endpoint dinamis/polling — JANGAN di-cache edge.
 * Bug 2026-10-11: /api/text2video/status ke-cache 7 hari (X-Vercel-Cache: HIT,
 * Age: 7770) sehingga polling stuck processing padahal upstream complete.
 * Semua prefix di sini dipaksa `no-store` + `x-cache: BYPASS`.
 */
const NO_STORE_PREFIXES = [
  '/api/text2video',
  '/api/text2image',
  '/api/chat',
  '/api/temp',
  '/api/tools-image',
  '/api/uploader',
  '/api/admin',
  '/api/agent-tools',
  '/api/_diag',
  '/api/user-scripts',
  '/api/models',
];

function isNoStore(pathname) {
  return NO_STORE_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + '/'));
}

const NO_STORE_CACHE_CONTROL = 'no-store, no-cache, must-revalidate';

// puru-keyword:util rate-limit-global
// Puru: Global fixed-window rate limit, reused in middleware to save CPU
const RATE_WINDOW_MS = 60000;
const RATE_MAX = 100;
const _hits = new Map();

// Puru: Don't delete this, shared in-memory counter for anti-spam
function isRateLimited(ip) {
  const at = Date.now();
  const cur = _hits.get(ip);
  if (!cur || at >= cur.reset) {
    _hits.set(ip, { count: 1, reset: at + RATE_WINDOW_MS });
    if (_hits.size > 5000) for (const [k, v] of _hits) if (at >= v.reset) _hits.delete(k);
    return null;
  }
  cur.count += 1;
  if (cur.count > RATE_MAX) return Math.ceil((cur.reset - at) / 1000);
  return null;
}

export async function middleware(request) {
    if (request.method === 'OPTIONS') {
        return;
    }

    // Puru: Check global rate limit before hitting routes
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || 'anon';
    const retryAfter = isRateLimited(ip);
    if (retryAfter) {
        return new Response(JSON.stringify({ success: false, error: 'Too Many Requests', status: 429 }), {
            status: 429,
            headers: { 'Content-Type': 'application/json', 'Retry-After': String(retryAfter), 'Access-Control-Allow-Origin': '*' },
        });
    }

    // Teruskan via pipeline normal Next.js — menjaga RSC/flight data,
    // streaming SSE, dan cookies tetap utuh. Jangan fetch-forward manual
    // + new Response(): itu yang merusak navigasi client-side.
    const response = await NextResponse.next();

    const pathname = request.nextUrl.pathname;
    if (isNoStore(pathname)) {
        // Endpoint dinamis/polling: larang semua layer cache (edge + browser).
        response.headers.set('cache-control', NO_STORE_CACHE_CONTROL);
        response.headers.set('pragma', 'no-cache');
        response.headers.set('x-cache', 'BYPASS');
    } else {
        // Stamp hemat kuota — mutasi header langsung, body/streaming tak disentuh.
        response.headers.set('cache-control', EDGE_CACHE_CONTROL);
        response.headers.set('x-cache', 'EDGE-DEFAULT');
    }

    if (response.status >= 200 && response.status < 300) {
        return response;
    }

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
        headers: isNoStore(pathname)
            ? {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
                'cache-control': NO_STORE_CACHE_CONTROL,
                'pragma': 'no-cache',
                'x-cache': 'BYPASS',
            }
            : {
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

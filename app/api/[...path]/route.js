import { backendBaseUrl } from '../../../lib/backendConfig';

/**
 * Catch-all proxy that forwards every /api/* request from the Next.js frontend
 * to the Go backend configured in config.json (or BACKEND_URL). Request and
 * response bodies are streamed, so SSE and NDJSON endpoints keep working.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

/** Headers that must not be forwarded in either direction. */
const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'host',
  'content-length',
  'accept-encoding',
]);

/**
 * Rebuild the upstream URL, re-encoding each path segment and keeping the
 * original query string untouched.
 * @param {Request} request Incoming Next.js request.
 * @param {string[]} segments Decoded catch-all path segments.
 * @returns {string} Absolute backend URL.
 */
function upstreamUrl(request, segments) {
  const pathname = segments.map((segment) => encodeURIComponent(segment)).join('/');
  const search = new URL(request.url).search;
  return `${backendBaseUrl()}/api/${pathname}${search}`;
}

/**
 * Forward a request to the Go backend and stream the response back.
 * @param {Request} request Incoming request.
 * @param {{ params: { path?: string[] } }} context Next.js route context.
 * @returns {Promise<Response>} Proxied response.
 */
async function proxy(request, { params }) {
  const target = upstreamUrl(request, params.path || []);
  const headers = new Headers();
  request.headers.forEach((value, key) => {
    if (!HOP_BY_HOP.has(key.toLowerCase())) headers.set(key, value);
  });
  if (!headers.has('x-forwarded-for')) {
    const forwarded = request.headers.get('x-real-ip');
    if (forwarded) headers.set('x-forwarded-for', forwarded);
  }

  const init = { method: request.method, headers, redirect: 'manual', cache: 'no-store', signal: request.signal };
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    init.body = request.body;
    init.duplex = 'half';
  }

  let upstream;
  try {
    upstream = await fetch(target, init);
  } catch (error) {
    console.error(`[proxy] backend unreachable at ${target}: ${error.message}`);
    return new Response(
      JSON.stringify({
        success: false,
        error: `Backend Go tidak dapat dihubungi (${backendBaseUrl()}). Periksa backendUrl di config.json atau jalankan backend.`,
        status: 502,
      }),
      { status: 502, headers: { 'content-type': 'application/json' } }
    );
  }

  const responseHeaders = new Headers();
  upstream.headers.forEach((value, key) => {
    const lower = key.toLowerCase();
    if (HOP_BY_HOP.has(lower) || lower === 'content-encoding') return;
    responseHeaders.set(key, value);
  });
  responseHeaders.set('x-backend-url', backendBaseUrl());

  return new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers: responseHeaders });
}

export {
  proxy as GET,
  proxy as POST,
  proxy as PUT,
  proxy as PATCH,
  proxy as DELETE,
  proxy as OPTIONS,
  proxy as HEAD,
};

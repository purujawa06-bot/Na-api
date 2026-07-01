/**
 * Middleware Global — Next.js 14 (Edge Runtime)
 * 
 * Meng-intercept SEMUA response API non-200 dan mengirim report ke Telegram.
 * Juga menangkap error yang terlewat dari try-catch di route handlers.
 * 
 * Cocok untuk: route yang return non-200 tanpa throw exception
 * (validasi 400, auth 401, not found 404, dll)
 * 
 * Runtime: Edge (otomatis oleh Next.js untuk middleware)
 */

// Rate limiter sederhana (in-memory, reset tiap deploy)
const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW = 5 * 60 * 1000; // 5 menit
const BOT_TOKEN = '8757256180:AAEFM7NpH1eWRNsV9gTU6s2Vbsg2OdvKFfI';
const CHAT_ID = '7004559855';

/**
 * Escape HTML untuk Telegram parse_mode
 */
function escapeHtml(text) {
    if (!text) return '';
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/**
 * Kirim pesan ke Telegram via fetch (Edge-compatible)
 */
async function sendTelegram(message) {
    try {
        const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
        const resp = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: CHAT_ID,
                text: message,
                parse_mode: 'HTML',
                disable_web_page_preview: true,
            }),
        });
        return resp.ok;
    } catch (err) {
        console.error('[Middleware] Gagal kirim ke Telegram:', err.message);
        return false;
    }
}

/**
 * Format pesan error untuk non-200 response
 */
function formatErrorMessage(status, statusText, endpoint, method, body) {
    const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
    const emoji = status >= 500 ? '🔴' : status >= 400 ? '🟡' : '⚪';

    let bodyStr = body ? JSON.stringify(body).substring(0, 200) : 'null';

    return [
        `${emoji} <b>Non-200 Response — Na-api</b>`,
        ``,
        `<b>⏱ Waktu:</b> ${timestamp}`,
        `<b>📍 Endpoint:</b> <code>${escapeHtml(endpoint)}</code>`,
        `<b>🔧 Method:</b> <code>${escapeHtml(method)}</code>`,
        `<b>📊 Status:</b> <code>${status} ${escapeHtml(statusText || '')}</code>`,
        bodyStr !== 'null' ? `\n<b>📦 Body:</b>\n<pre>${escapeHtml(bodyStr)}</pre>` : '',
        ``,
        `<i>⚠️ Response non-200 terdeteksi oleh middleware</i>`,
    ].filter(Boolean).join('\n');
}

/**
 * Check rate limit untuk mencegah spam
 * Key: endpoint + status code
 */
function isRateLimited(endpoint, status) {
    const key = `${endpoint}:${status}`;
    const now = Date.now();
    const lastReport = rateLimitMap.get(key);

    if (lastReport && (now - lastReport) < RATE_LIMIT_WINDOW) {
        return true; // Still within rate limit window
    }

    rateLimitMap.set(key, now);
    return false;
}

export async function middleware(request) {
    const url = request.nextUrl;
    const pathname = url.pathname;

    // Hanya intercept API routes
    if (!pathname.startsWith('/api/')) {
        return;
    }

    // Skip jika method OPTIONS (CORS preflight)
    if (request.method === 'OPTIONS') {
        return;
    }

    // Clone request untuk dibaca bodynya
    let requestBody = null;
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) {
        try {
            const cloned = request.clone();
            requestBody = await cloned.json().catch(() => null);
        } catch (e) {
            // ignore
        }
    }

    // Lanjutkan request ke handler
    const response = await fetch(request);

    // Jika response OK (2xx), tidak perlu report
    if (response.status >= 200 && response.status < 300) {
        return response;
    }

    // --- Non-200 response ---

    // Rate limiting: jangan spam untuk error yang sama
    if (isRateLimited(pathname, response.status)) {
        return response; // Skip report, return response as-is
    }

    // Ambil response body untuk context
    let responseBody = null;
    try {
        const cloned = response.clone();
        responseBody = await cloned.json().catch(() => null);
    } catch (e) {
        // ignore
    }

    // Format & kirim ke Telegram (fire-and-forget)
    const message = formatErrorMessage(
        response.status,
        response.statusText,
        pathname,
        request.method,
        requestBody || responseBody
    );

    // Fire and forget — jangan blokir response
    sendTelegram(message).catch(() => {});

    // Log ke console
    console.error(`[Middleware] Non-200: ${pathname} | ${request.method} | ${response.status}`);

    return response;
}

// Hanya aktif untuk /api/* routes
export const config = {
    matcher: '/api/:path*',
};

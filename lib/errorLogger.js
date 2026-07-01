/**
 * Error Logger — Telegram Error Reporter
 * Mengirim error + endpoint ke Telegram secara real-time
 */
const BOT_TOKEN = '8757256180:AAEFM7NpH1eWRNsV9gTU6s2Vbsg2OdvKFfI';
const CHAT_ID = '7004559855';
const API_BASE = `https://api.telegram.org/bot${BOT_TOKEN}`;

/**
 * Escape HTML untuk Telegram parse_mode HTML
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
 * Kirim pesan error ke Telegram
 */
async function sendTelegram(message) {
    try {
        const url = `${API_BASE}/sendMessage`;
        const body = {
            chat_id: CHAT_ID,
            text: message,
            parse_mode: 'HTML',
            disable_web_page_preview: true,
        };

        const resp = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });

        if (!resp.ok) {
            const errText = await resp.text();
            console.error('[ErrorLogger] Gagal kirim ke Telegram:', errText);
        }

        return resp.ok;
    } catch (err) {
        console.error('[ErrorLogger] Gagal kirim ke Telegram:', err.message);
        return false;
    }
}

/**
 * Report error ke Telegram dengan detail lengkap
 * 
 * @param {Error} error - Error object
 * @param {Object} context - Konteks error
 * @param {string} context.endpoint - Nama endpoint / path
 * @param {string} context.method - HTTP method (GET, POST, etc)
 * @param {Object} context.body - Request body (jika ada)
 * @param {Object} context.params - Query/URL params (jika ada)
 * @param {string} context.ip - Client IP (jika ada)
 * @param {Object} context.headers - Request headers (jika perlu)
 */
async function reportError(error, context = {}) {
    try {
        const {
            endpoint = 'unknown',
            method = 'unknown',
            body = null,
            params = null,
            ip = null,
        } = context;

        // Format error message
        const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
        const errorName = error.name || 'Error';
        const errorMessage = error.message || 'No message';
        const errorStack = error.stack 
            ? error.stack.split('\n').slice(0, 6).join('\n').substring(0, 500)
            : 'No stack trace';

        // Truncate body/params if too long
        let bodyStr = body ? JSON.stringify(body, null, 2) : 'null';
        if (bodyStr.length > 300) bodyStr = bodyStr.substring(0, 300) + '...';
        let paramsStr = params ? JSON.stringify(params, null, 2) : 'null';
        if (paramsStr.length > 300) paramsStr = paramsStr.substring(0, 300) + '...';

        const message = [
            `<b>🔴 ERROR REPORT — Na-api</b>`,
            ``,
            `<b>⏱ Waktu:</b> ${timestamp}`,
            `<b>📍 Endpoint:</b> <code>${escapeHtml(endpoint)}</code>`,
            `<b>🔧 Method:</b> <code>${escapeHtml(method)}</code>`,
            ip ? `<b>🌐 IP:</b> <code>${escapeHtml(ip)}</code>` : '',
            ``,
            `<b>⚠️ Error:</b> ${escapeHtml(errorName)}`,
            `<code>${escapeHtml(errorMessage.substring(0, 300))}</code>`,
            ``,
            `<b>📚 Stack:</b>`,
            `<pre>${escapeHtml(errorStack)}</pre>`,
            body && bodyStr !== 'null' ? `\n<b>📦 Body:</b>\n<pre>${escapeHtml(bodyStr)}</pre>` : '',
            params && paramsStr !== 'null' ? `\n<b>🔗 Params:</b>\n<pre>${escapeHtml(paramsStr)}</pre>` : '',
        ].filter(Boolean).join('\n');

        await sendTelegram(message);

        // Log ke console juga
        console.error(`[ErrorLogger] ${endpoint} | ${errorName}: ${errorMessage}`);
    } catch (err) {
        console.error('[ErrorLogger] Fatal error dalam reporter:', err.message);
    }
}

/**
 * Higher-order function: Bungkus route handler agar auto-capture error
 * 
 * @param {Function} handler - Route handler async function
 * @param {string} endpointName - Nama endpoint (opsional, auto-detect jika kosong)
 * @returns {Function} Wrapped handler
 */
function withErrorCapture(handler, endpointName = null) {
    return async function(req, ...args) {
        try {
            return await handler(req, ...args);
        } catch (error) {
            const url = req.nextUrl || req.url || 'unknown';
            const endpoint = endpointName || url?.pathname || req.headers?.get('x-forwarded-path') || 'unknown';
            
            // Extract context
            let body = null;
            try {
                if (req.body) {
                    // Read body if possible
                    const cloned = req.clone ? req.clone() : req;
                    body = await cloned.json().catch(() => null);
                }
            } catch (e) { /* ignore */ }

            // Kirim report (fire-and-forget)
            reportError(error, {
                endpoint: String(endpoint),
                method: req.method || req.method || 'UNKNOWN',
                body,
                params: Object.fromEntries(req.nextUrl?.searchParams?.entries() || []),
                ip: req.headers?.get('x-forwarded-for') || req.headers?.get('x-real-ip') || null,
            });

            // Re-throw agar Next.js handle response
            throw error;
        }
    };
}

module.exports = { reportError, withErrorCapture, sendTelegram };

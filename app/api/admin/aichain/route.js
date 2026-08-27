/**
 * @title AI Fallback Chain
 * @summary Konfigurasi urutan model untuk mode "auto" di /api/chat/completions.
 * @description Get/Set urutan provider (Gemini, DeepSeek, dll) yang akan dicoba secara berurutan.
 * @method GET
 * @path /api/admin/aichain
 * 
 * @method POST
 * @path /api/admin/aichain
 * @header Authorization - Admin Key
 * @param {string[]} body - Array ID model sesuai urutan prioritas.
 * @response json
 * @example
 * // GET: ambil urutan fallback saat ini
 * fetch('https://puruboy-api.vercel.app/api/admin/aichain')
 *     .then(res => res.json())
 *     .then(console.log);
 *
 * // POST: set urutan fallback (admin only)
 * fetch('https://puruboy-api.vercel.app/api/admin/aichain', {
 *     method: 'POST',
 *     headers: { 'content-type': 'application/json', 'Authorization': '<PURUBOY_ADMIN_KEY>' },
 *     body: JSON.stringify({ chain: ['gemini-pro', 'deepseek-chat'] })
 * }).then(res => res.json()).then(console.log);
 */
import { NextResponse } from 'next/server';
import settingsService from '../../../../lib/settingsService';
import { reportError } from '../../../../lib/errorLogger';

export const dynamic = 'force-dynamic';

const checkAuth = (req) => {
    const password = req.headers.get('authorization');
    if (!password || password !== process.env.PURUBOY_ADMIN_KEY) return { authorized: false, error: 'Invalid password' };
    return { authorized: true };
};

/**
 * Urutan fallback model 'auto' pada /api/chat/completions.
 * GET sengaja publik (tanpa rahasia, pola sama dgn /admin/featured) supaya
 * panel admin bisa menampilkan state terkini sebelum login.
 * POST butuh header Authorization: <PURUBOY_ADMIN_KEY>.
 */
export async function GET(req) {
    try {
        const chain = await settingsService.getAutoChain();
        return NextResponse.json({ chain });
    } catch (error) {
        reportError(error, { endpoint: '/admin/aichain', method: 'GET' }).catch(() => {});
        return NextResponse.json({ error: 'Gagal memuat urutan fallback' }, { status: 500 });
    }
}

export async function POST(req) {
    const auth = checkAuth(req);
    if (!auth.authorized) return NextResponse.json({ error: auth.error }, { status: 401 });

    try {
        const body = await req.json();
        const chain = Array.isArray(body) ? body : body?.chain;
        const saved = await settingsService.setAutoChain(chain);
        return NextResponse.json({ chain: saved });
    } catch (error) {
        reportError(error, { endpoint: '/admin/aichain', method: 'POST' }).catch(() => {});
        // Input tak valid -> 400, sisanya kegagalan DB -> 500
        const status = error?.message?.includes('tidak valid') ? 400 : 500;
        return NextResponse.json({ error: error.message }, { status });
    }
}

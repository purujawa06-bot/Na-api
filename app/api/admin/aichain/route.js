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

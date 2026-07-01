import { NextResponse } from 'next/server';
import settingsService from '../../../../lib/settingsService';
import { reportError } from '../../../../lib/errorLogger';

export const dynamic = 'force-dynamic';

const checkAuth = (req) => {
    const password = req.headers.get('authorization');
    if (!password || password !== process.env.PURUBOY_ADMIN_KEY) return { authorized: false, error: 'Invalid password' };
    return { authorized: true };
};

export async function GET(req) {
    try {
        const featured = await settingsService.getFeatured();
        return NextResponse.json(featured || {});
    } catch (error) {
        // Auto-report error ke Telegram
        reportError(error, { endpoint: '/admin/featured', method: 'GET' }).catch(() => {});

        return NextResponse.json({ error: 'Failed to fetch featured endpoint' }, { status: 500 });
    }
}

export async function POST(req) {
    const auth = checkAuth(req);
    if (!auth.authorized) return NextResponse.json({ error: auth.error }, { status: 401 });

    try {
        const body = await req.json();
        const updated = await settingsService.setFeatured(body);
        return NextResponse.json(updated);
    } catch (error) {
        // Auto-report error ke Telegram
        reportError(error, { endpoint: '/admin/featured', method: 'POST' }).catch(() => {});

        return NextResponse.json({ error: 'Failed to update featured endpoint' }, { status: 500 });
    }
}
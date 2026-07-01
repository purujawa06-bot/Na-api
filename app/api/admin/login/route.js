import { NextResponse } from 'next/server';
import { reportError } from '../../../../lib/errorLogger';

export async function POST(req) {
    try {
        const body = await req.json();
        if (body.password === process.env.PURUBOY_ADMIN_KEY) {
            return NextResponse.json({ success: true, message: 'Login successful' });
        } else {
            // 401 akan ditangkap middleware dan dikirim ke Telegram
            return NextResponse.json({ success: false, message: 'Invalid password' }, { status: 401 });
        }
    } catch (error) {
        reportError(error, { endpoint: '/admin/login', method: 'POST' }).catch(() => {});
        return NextResponse.json({ success: false, error: 'Invalid request body' }, { status: 400 });
    }
}
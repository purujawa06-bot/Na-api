/**
 * @title Admin Login
 * @summary Validasi kredensial admin.
 * @description Mengecek apakah password sesuai dengan PURUBOY_ADMIN_KEY.
 * @method POST
 * @path /api/admin/login
 * @param {string} body.password - Password admin.
 * @response json
 * @example
 * fetch('https://puruboy-api.vercel.app/api/admin/login', {
 *     method: 'POST',
 *     headers: { 'content-type': 'application/json' },
 *     body: JSON.stringify({ password: '<PURUBOY_ADMIN_KEY>' })
 * }).then(res => res.json()).then(console.log);
 */
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
import { NextResponse } from 'next/server';
import snaptikController from '../../../../lib/controllers/downloader/snaptik';
import { reportError } from '../../../../lib/errorLogger';

export const dynamic = 'force-dynamic';

export async function POST(req) {
    try {
        const body = await req.json();
        const mockReq = { body };
        
        const result = await snaptikController(mockReq);
        return NextResponse.json(result);
    } catch (error) {
        // Auto-report error ke Telegram
        reportError(error, { endpoint: '/downloader/snaptik', method: 'POST' }).catch(() => {});

        return NextResponse.json({ 
            success: false, 
            message: error.message 
        }, { status: 500 });
    }
}
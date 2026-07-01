import { NextResponse } from 'next/server';
import fbdlController from '../../../../lib/controllers/downloader/fbdl';
import { reportError } from '../../../../lib/errorLogger';

export async function POST(req) {
    try {
        const body = await req.json();
        
        const mockReq = { body };
        
        const result = await fbdlController(mockReq);
        return NextResponse.json(result);
    } catch (error) {
        // Auto-report error ke Telegram
        reportError(error, { endpoint: '/downloader/fbdl', method: 'POST' }).catch(() => {});

        return NextResponse.json({ 
            success: false, 
            message: error.message 
        }, { status: 500 });
    }
}
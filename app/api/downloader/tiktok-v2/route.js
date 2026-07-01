import { NextResponse } from 'next/server';
import tiktokV2Controller from '../../../../lib/controllers/downloader/tiktokV2';
import { reportError } from '../../../../lib/errorLogger';

export const dynamic = 'force-dynamic';

export async function POST(req) {
    try {
        const body = await req.json();
        const mockReq = { body };
        
        const result = await tiktokV2Controller(mockReq);
        return NextResponse.json(result);
    } catch (error) {
        // Auto-report error ke Telegram
        reportError(error, { endpoint: '/downloader/tiktok-v2', method: 'POST' }).catch(() => {});

        return NextResponse.json({ 
            success: false, 
            message: error.message 
        }, { status: 500 });
    }
}
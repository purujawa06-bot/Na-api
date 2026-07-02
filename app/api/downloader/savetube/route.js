import { NextResponse } from 'next/server';
import savetubeController from '../../../../lib/controllers/downloader/savetube';
import { reportError } from '../../../../lib/errorLogger';

export const maxDuration = 60;

export async function POST(req) {
    try {
        const body = await req.json();
        const mockReq = { body };
        
        const result = await savetubeController(mockReq);
        return NextResponse.json(result);
    } catch (error) {
        // Auto-report error ke Telegram
        reportError(error, { endpoint: '/downloader/savetube', method: 'POST' }).catch(() => {});

        return NextResponse.json({ 
            success: false, 
            message: error.message 
        }, { status: 400 });
    }
}
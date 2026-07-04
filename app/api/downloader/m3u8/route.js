import { NextResponse } from 'next/server';
import m3u8Controller from '../../../../lib/controllers/downloader/m3u8';
import { reportError } from '../../../../lib/errorLogger';

// Konversi M3U8 bisa memakan waktu hingga 5 menit
export const maxDuration = 300;

export async function POST(req) {
    try {
        const body = await req.json();
        const mockReq = { body };
        
        const result = await m3u8Controller(mockReq);
        return NextResponse.json(result);
    } catch (error) {
        // Auto-report error ke Telegram
        reportError(error, { endpoint: '/downloader/m3u8', method: 'POST' }).catch(() => {});

        return NextResponse.json({ 
            success: false, 
            message: error.message 
        }, { status: 400 });
    }
}

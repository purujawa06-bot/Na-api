import { NextResponse } from 'next/server';
import ytmp3Controller from '../../../../lib/controllers/downloader/ytmp3';
import { reportError } from '../../../../lib/errorLogger';

// Proses konversi dan polling status bisa memakan waktu hingga 60 detik
export const maxDuration = 60; 

export async function POST(req) {
    try {
        const body = await req.json();
        const mockReq = { body };
        
        const result = await ytmp3Controller(mockReq);
        return NextResponse.json(result);
    } catch (error) {
        // Auto-report error ke Telegram
        reportError(error, { endpoint: '/downloader/ytmp3', method: 'POST' }).catch(() => {});

        return NextResponse.json({ 
            success: false, 
            message: error.message 
        }, { status: 400 });
    }
}
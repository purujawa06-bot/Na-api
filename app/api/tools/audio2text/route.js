import { NextResponse } from 'next/server';
import audio2textController from '../../../../lib/controllers/tools/audio2text';
import { reportError } from '../../../../lib/errorLogger';

// Pemrosesan transkripsi AI bisa memakan waktu
export const maxDuration = 60; 

export async function POST(req) {
    try {
        const body = await req.json();
        const mockReq = { body };
        
        const result = await audio2textController(mockReq);
        return NextResponse.json(result);
    } catch (error) {
        // Auto-report error ke Telegram
        reportError(error, { endpoint: '/tools/audio2text', method: 'POST' }).catch(() => {});

        return NextResponse.json({ 
            success: false, 
            message: error.message 
        }, { status: 500 });
    }
}
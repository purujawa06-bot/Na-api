import { NextResponse } from 'next/server';
import geminiV3Controller from '../../../../lib/controllers/ai/geminiV3';
import { reportError } from '../../../../lib/errorLogger';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req) {
    try {
        const body = await req.json();
        const mockReq = { body };

        const sdkResponse = await geminiV3Controller(mockReq);

        // Jika sdkResponse null/kosong, kembalikan error
        if (!sdkResponse) {
            return NextResponse.json({ 
                error: true, 
                message: 'Gagal mendapatkan response dari Gemini SDK'
            }, { status: 502 });
        }

        // Kembalikan langsung JSON murni Gemini SDK (candidates, usageMetadata, dll)
        return NextResponse.json(sdkResponse);
    } catch (error) {
        // Auto-report error ke Telegram
        reportError(error, { endpoint: '/ai/gemini-v3', method: 'POST' }).catch(() => {});

        return NextResponse.json({ 
            error: true, 
            message: error.message 
        }, { status: 500 });
    }
}
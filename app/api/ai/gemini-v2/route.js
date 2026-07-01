import { NextResponse } from 'next/server';
import geminiV2Controller from '../../../../lib/controllers/ai/geminiV2';
import { reportError } from '../../../../lib/errorLogger';

export const runtime = 'nodejs';

export async function POST(req) {
    try {
        const body = await req.json();
        const mockReq = { body };
        
        const result = await geminiV2Controller(mockReq);
        return NextResponse.json(result);
    } catch (error) {
        // Auto-report error ke Telegram
        reportError(error, { endpoint: '/ai/gemini-v2', method: 'POST' }).catch(() => {});

        return NextResponse.json({ 
            success: false, 
            message: error.message 
        }, { status: 500 });
    }
}
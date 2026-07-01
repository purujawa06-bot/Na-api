import { NextResponse } from 'next/server';
import translappController from '../../../../lib/controllers/ai/translapp';
import { reportError } from '../../../../lib/errorLogger';

export async function POST(req) {
    try {
        const body = await req.json();
        
        const mockReq = { body };
        
        const result = await translappController(mockReq);
        return NextResponse.json(result);
    } catch (error) {
        // Auto-report error ke Telegram
        reportError(error, { endpoint: '/ai/translapp', method: 'POST' }).catch(() => {});

        return NextResponse.json({ 
            success: false, 
            message: error.message 
        }, { status: 500 });
    }
}
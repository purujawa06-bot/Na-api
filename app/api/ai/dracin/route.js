import { NextResponse } from 'next/server';
import dracinController from '../../../../lib/controllers/ai/dracin';
import { reportError } from '../../../../lib/errorLogger';


export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req) {
    try {
        const body = await req.json();
        const origin = new URL(req.url).origin;
        
        const mockReq = { body, origin };
        
        const result = await dracinController(mockReq);
        return NextResponse.json(result);
    } catch (error) {
        // Auto-report error ke Telegram
        reportError(error, { endpoint: '/ai/dracin', method: 'POST' }).catch(() => {});

        return NextResponse.json({ 
            success: false, 
            message: error.message 
        }, { status: 500 });
    }
}
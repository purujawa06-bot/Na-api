import { NextResponse } from 'next/server';
import bratController from '../../../../lib/controllers/tools/brat';
import { reportError } from '../../../../lib/errorLogger';


export const dynamic = 'force-dynamic';
export async function POST(req) {
    try {
        const body = await req.json();
        const origin = new URL(req.url).origin;
        
        const mockReq = { body, origin };
        
        const result = await bratController(mockReq);
        return NextResponse.json(result);
    } catch (error) {
        // Auto-report error ke Telegram
        reportError(error, { endpoint: '/tools/brat', method: 'POST' }).catch(() => {});

        return NextResponse.json({ 
            success: false, 
            message: error.message 
        }, { status: 500 });
    }
}
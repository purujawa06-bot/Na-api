import { NextResponse } from 'next/server';
import dubbingController from '../../../../lib/controllers/tools/dubbing';
import { reportError } from '../../../../lib/errorLogger';


export const dynamic = 'force-dynamic';
export const maxDuration = 60; 

export async function POST(req) {
    try {
        const body = await req.json();
        const origin = new URL(req.url).origin;
        
        const mockReq = { body, origin };
        
        const result = await dubbingController(mockReq);
        return NextResponse.json(result);
    } catch (error) {
        // Auto-report error ke Telegram
        reportError(error, { endpoint: '/tools/dubbing', method: 'POST' }).catch(() => {});

        return NextResponse.json({ 
            status: 'error', 
            message: error.message 
        }, { status: 500 });
    }
}
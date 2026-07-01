import { NextResponse } from 'next/server';
import autoclipController from '../../../../lib/controllers/tools/autoclip';
import { reportError } from '../../../../lib/errorLogger';


export const dynamic = 'force-dynamic';
export const maxDuration = 60; 

export async function POST(req) {
    try {
        const body = await req.json();
        const origin = new URL(req.url).origin;
        
        const mockReq = { body, origin };
        
        const result = await autoclipController(mockReq);
        return NextResponse.json(result);
    } catch (error) {
        // Auto-report error ke Telegram
        reportError(error, { endpoint: '/tools/autoclip', method: 'POST' }).catch(() => {});

        return NextResponse.json({ 
            status: 'error', 
            message: error.message 
        }, { status: 500 });
    }
}
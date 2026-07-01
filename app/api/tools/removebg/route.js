import { NextResponse } from 'next/server';
import removeBgController from '../../../../lib/controllers/tools/removebg';
import { reportError } from '../../../../lib/errorLogger';


export const dynamic = 'force-dynamic';
export async function POST(req) {
    try {
        const body = await req.json();
        const origin = new URL(req.url).origin;
        
        // Mock request object for controller
        const mockReq = { body, origin };
        
        const result = await removeBgController(mockReq);
        return NextResponse.json(result);
    } catch (error) {
        // Auto-report error ke Telegram
        reportError(error, { endpoint: '/tools/removebg', method: 'POST' }).catch(() => {});

        return NextResponse.json({ 
            status: 'error', 
            message: error.message 
        }, { status: 500 });
    }
}
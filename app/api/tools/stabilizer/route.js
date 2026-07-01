import { NextResponse } from 'next/server';
import stabilizerController from '../../../../lib/controllers/tools/stabilizer';
import { reportError } from '../../../../lib/errorLogger';


export const dynamic = 'force-dynamic';
export async function POST(req) {
    try {
        const body = await req.json();
        const origin = new URL(req.url).origin;
        
        // Mock request object for controller
        const mockReq = { body, origin };
        
        const result = await stabilizerController(mockReq);
        return NextResponse.json(result);
    } catch (error) {
        // Auto-report error ke Telegram
        reportError(error, { endpoint: '/tools/stabilizer', method: 'POST' }).catch(() => {});

        return NextResponse.json({ 
            status: 'error', 
            message: error.message 
        }, { status: 500 });
    }
}
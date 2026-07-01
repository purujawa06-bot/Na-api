import { NextResponse } from 'next/server';
import audioeditController from '../../../../lib/controllers/tools/audioedit';
import { reportError } from '../../../../lib/errorLogger';


export const dynamic = 'force-dynamic';
export async function POST(req) {
    try {
        const body = await req.json();
        const origin = new URL(req.url).origin;
        
        const mockReq = { body, origin };
        
        const result = await audioeditController(mockReq);
        return NextResponse.json(result);
    } catch (error) {
        // Auto-report error ke Telegram
        reportError(error, { endpoint: '/tools/audioedit', method: 'POST' }).catch(() => {});

        return NextResponse.json({ 
            status: 'error', 
            message: error.message 
        }, { status: 500 });
    }
}
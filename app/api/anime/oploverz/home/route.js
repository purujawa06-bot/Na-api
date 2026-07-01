import { NextResponse } from 'next/server';
import oploverzHomeController from '../../../../../lib/controllers/anime/oploverzHome';
import { reportError } from '../../../../../lib/errorLogger';

export const dynamic = 'force-dynamic';

export async function GET(req) {
    try {
        const origin = new URL(req.url).origin;
        
        // Mock req with origin
        const mockReq = { origin };
        
        const result = await oploverzHomeController(mockReq);
        return NextResponse.json(result);
    } catch (error) {
        // Auto-report error ke Telegram
        reportError(error, { endpoint: '/anime/oploverz/home', method: 'GET' }).catch(() => {});

        return NextResponse.json({ 
            success: false, 
            message: error.message 
        }, { status: 500 });
    }
}
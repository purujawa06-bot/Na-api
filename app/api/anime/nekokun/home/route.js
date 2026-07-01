import { NextResponse } from 'next/server';
import nekokunHomeController from '../../../../../lib/controllers/anime/nekokunHome';
import { reportError } from '../../../../../lib/errorLogger';

export const dynamic = 'force-dynamic';

export async function GET(req) {
    try {
        const origin = new URL(req.url).origin;
        const { searchParams } = new URL(req.url);
        const page = searchParams.get('page') || 1;
        
        const mockReq = { origin, query: { page } };
        
        const result = await nekokunHomeController(mockReq);
        return NextResponse.json(result);
    } catch (error) {
        // Auto-report error ke Telegram
        reportError(error, { endpoint: '/anime/nekokun/home', method: 'GET' }).catch(() => {});

        return NextResponse.json({ 
            success: false, 
            message: error.message 
        }, { status: 500 });
    }
}

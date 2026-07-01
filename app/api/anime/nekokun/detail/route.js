import { NextResponse } from 'next/server';
import nekokunDetailController from '../../../../../lib/controllers/anime/nekokunDetail';
import { reportError } from '../../../../../lib/errorLogger';

export const dynamic = 'force-dynamic';

export async function GET(req) {
    try {
        const origin = new URL(req.url).origin;
        const { searchParams } = new URL(req.url);
        const url = searchParams.get('url');
        
        const mockReq = { origin, query: { url } };
        
        const result = await nekokunDetailController(mockReq);
        return NextResponse.json(result);
    } catch (error) {
        // Auto-report error ke Telegram
        reportError(error, { endpoint: '/anime/nekokun/detail', method: 'GET' }).catch(() => {});

        return NextResponse.json({ 
            success: false, 
            message: error.message 
        }, { status: 500 });
    }
}

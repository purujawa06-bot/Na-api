import { NextResponse } from 'next/server';
import komikuPopularController from '../../../../../lib/controllers/anime/komikuPopular';
import { reportError } from '../../../../../lib/errorLogger';

export const dynamic = 'force-dynamic';

export async function GET(req) {
    try {
        const { searchParams } = new URL(req.url);
        const query = Object.fromEntries(searchParams);
        const origin = new URL(req.url).origin;
        
        const mockReq = { query, origin };
        
        const result = await komikuPopularController(mockReq);
        return NextResponse.json(result);
    } catch (error) {
        // Auto-report error ke Telegram
        reportError(error, { endpoint: '/anime/komiku/popular', method: 'GET' }).catch(() => {});

        return NextResponse.json({ 
            success: false, 
            message: error.message 
        }, { status: 500 });
    }
}
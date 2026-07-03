import { NextResponse } from 'next/server';
import samehadakuSearchController from '../../../../../lib/controllers/anime/samehadakuSearch';
import { reportError } from '../../../../../lib/errorLogger';

export const dynamic = 'force-dynamic';

export async function GET(req) {
    try {
        const { searchParams } = new URL(req.url);
        const query = Object.fromEntries(searchParams);
        const origin = new URL(req.url).origin;
        
        // Validasi parameter q
        if (!query.q) {
            return NextResponse.json({ 
                success: false, 
                message: "Parameter 'q' wajib diisi." 
            }, { status: 400 });
        }
        
        const mockReq = { query, origin };
        
        const result = await samehadakuSearchController(mockReq);
        return NextResponse.json(result);
    } catch (error) {
        // Auto-report error ke Telegram
        reportError(error, { endpoint: '/anime/samehadaku/search', method: 'GET' }).catch(() => {});

        return NextResponse.json({ 
            success: false, 
            message: error.message 
        }, { status: 500 });
    }
}
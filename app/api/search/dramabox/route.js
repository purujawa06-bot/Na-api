import { NextResponse } from 'next/server';
import dramaboxSearchController from '../../../../lib/controllers/search/dramabox';
import { reportError } from '../../../../lib/errorLogger';

export const dynamic = 'force-dynamic';

export async function GET(req) {
    try {
        const { searchParams } = new URL(req.url);
        const query = Object.fromEntries(searchParams);
        
        // Mock request object for controller
        const mockReq = { query };
        
        const result = await dramaboxSearchController(mockReq);
        return NextResponse.json(result);
    } catch (error) {
        // Auto-report error ke Telegram
        reportError(error, { endpoint: '/search/dramabox', method: 'GET' }).catch(() => {});

        return NextResponse.json({ 
            success: false, 
            message: error.message 
        }, { status: 500 });
    }
}

import { NextResponse } from 'next/server';
import dramaboxSearchController from '../../../../../lib/controllers/drama/dramaboxSearch';
import { reportError } from '../../../../../lib/errorLogger';

export const dynamic = 'force-dynamic';

export async function GET(req) {
    try {
        const { searchParams } = new URL(req.url);
        const query = Object.fromEntries(searchParams);
        
        const mockReq = { query };
        
        const result = await dramaboxSearchController(mockReq);
        return NextResponse.json(result);
    } catch (error) {
        reportError(error, { endpoint: '/drama/dramabox/search', method: 'GET' }).catch(() => {});

        return NextResponse.json({ 
            success: false, 
            message: error.message 
        }, { status: 500 });
    }
}

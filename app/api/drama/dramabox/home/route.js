import { NextResponse } from 'next/server';
import dramaboxHomeController from '../../../../../lib/controllers/drama/dramaboxHome';
import { reportError } from '../../../../../lib/errorLogger';

export const dynamic = 'force-dynamic';

export async function GET(req) {
    try {
        const mockReq = { query: {} };
        
        const result = await dramaboxHomeController(mockReq);
        return NextResponse.json(result);
    } catch (error) {
        reportError(error, { endpoint: '/drama/dramabox/home', method: 'GET' }).catch(() => {});

        return NextResponse.json({ 
            success: false, 
            message: error.message 
        }, { status: 500 });
    }
}

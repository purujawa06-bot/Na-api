import { NextResponse } from 'next/server';
import billboardController from '../../../../lib/controllers/chart/billboard';
import { reportError } from '../../../../lib/errorLogger';

export const dynamic = 'force-dynamic';

export async function GET(req) {
    try {
        const { searchParams, origin } = new URL(req.url);
        const query = Object.fromEntries(searchParams);
        const mockReq = { query, origin };
        const result = await billboardController(mockReq);
        return NextResponse.json(result);
    } catch (error) {
        // Auto-report error ke Telegram
        reportError(error, { endpoint: '/chart/billboard', method: 'GET' }).catch(() => {});

        return NextResponse.json({
            success: false,
            message: error.message
        }, { status: 500 });
    }
}

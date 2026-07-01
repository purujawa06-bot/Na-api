import { NextResponse } from 'next/server';
import tiktokChartController from '../../../../lib/controllers/chart/tiktok';
import { reportError } from '../../../../lib/errorLogger';


export const dynamic = 'force-dynamic';
export async function GET(req) {
    try {
        const { searchParams } = new URL(req.url);
        const query = Object.fromEntries(searchParams);
        const origin = req.headers.get('origin') || req.headers.get('host') || '';
        const mockReq = { query, origin };
        const result = await tiktokChartController(mockReq);
        return NextResponse.json(result);
    } catch (error) {
        // Auto-report error ke Telegram
        reportError(error, { endpoint: '/chart/tiktok', method: 'GET' }).catch(() => {});

        return NextResponse.json({
            success: false,
            error: error.message
        }, { status: 500 });
    }
}
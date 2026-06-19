import { NextResponse } from 'next/server';
import billboardController from '../../../../lib/controllers/chart/billboard';

export const dynamic = 'force-dynamic';

export async function GET(req) {
    try {
        const { searchParams } = new URL(req.url);
        const query = Object.fromEntries(searchParams);
        const mockReq = { query };
        const result = await billboardController(mockReq);
        return NextResponse.json(result);
    } catch (error) {
        return NextResponse.json({
            success: false,
            message: error.message
        }, { status: 500 });
    }
}

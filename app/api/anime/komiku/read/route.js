import { NextResponse } from 'next/server';
import komikuReadController from '../../../../../lib/controllers/anime/komikuRead';

export const dynamic = 'force-dynamic';

export async function GET(req) {
    try {
        const { searchParams } = new URL(req.url);
        const query = Object.fromEntries(searchParams);
        const origin = new URL(req.url).origin;
        
        const mockReq = { query, origin };
        
        const result = await komikuReadController(mockReq);
        return NextResponse.json(result);
    } catch (error) {
        return NextResponse.json({
            success: false,
            message: error.message
        }, { status: 500 });
    }
}
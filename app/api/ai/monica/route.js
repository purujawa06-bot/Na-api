import { NextResponse } from 'next/server';
import monicaController from '../../../../lib/controllers/ai/monica';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req) {
    try {
        const body = await req.json();
        
        const result = await monicaController({ body });
        return NextResponse.json(result);
    } catch (error) {
        return NextResponse.json({ 
            success: false, 
            author: 'PuruBoy',
            message: error.message,
            error: error.message 
        }, { status: 500 });
    }
}

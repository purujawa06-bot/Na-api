import { NextResponse } from 'next/server';
import monicaController from '../../../../lib/controllers/ai/monica';
import { reportError } from '../../../../lib/errorLogger';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req) {
    try {
        const { prompt } = await req.json();
        
        if (!prompt) {
            return NextResponse.json({
                success: false,
                author: 'PuruBoy',
                message: "Parameter 'prompt' wajib diisi."
            }, { status: 400 });
        }

        const result = await monicaController({ prompt });
        return NextResponse.json(result);
    } catch (error) {
        // Auto-report error ke Telegram
        reportError(error, { endpoint: '/ai/monica', method: 'POST' }).catch(() => {});

        return NextResponse.json({ 
            success: false, 
            author: 'PuruBoy',
            message: error.message,
            error: error.message 
        }, { status: 500 });
    }
}

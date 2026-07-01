import { NextResponse } from 'next/server';
import chatEspanyolController from '../../../../lib/controllers/ai/chatespanyol';
import { reportError } from '../../../../lib/errorLogger';

export async function POST(req) {
    try {
        const body = await req.json();
        
        // Mock request object for controller
        const mockReq = { body };
        
        const result = await chatEspanyolController(mockReq);
        return NextResponse.json(result);
    } catch (error) {
        // Auto-report error ke Telegram
        reportError(error, { endpoint: '/ai/chatespanyol', method: 'POST' }).catch(() => {});

        return NextResponse.json({ 
            success: false, 
            message: error.message 
        }, { status: 500 });
    }
}
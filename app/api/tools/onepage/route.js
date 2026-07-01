import { NextResponse } from 'next/server';
import onepageController from '../../../../lib/controllers/tools/onepage';
import { reportError } from '../../../../lib/errorLogger';

export const maxDuration = 60; 

export async function POST(req) {
    try {
        const body = await req.json();
        
        // Mock request object for controller
        const mockReq = { body };
        
        const result = await onepageController(mockReq);
        return NextResponse.json(result);
    } catch (error) {
        // Auto-report error ke Telegram
        reportError(error, { endpoint: '/tools/onepage', method: 'POST' }).catch(() => {});

        return NextResponse.json({ 
            success: false, 
            message: error.message 
        }, { status: 500 });
    }
}
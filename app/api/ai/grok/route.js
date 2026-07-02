import { NextResponse } from 'next/server';
import grokController from '../../../../lib/controllers/ai/grok';
import { reportError } from '../../../../lib/errorLogger';

export async function POST(req) {
    try {
        const body = await req.json();
        
        // Validasi input
        if (!body || !body.message) {
            return NextResponse.json({ 
                success: false, 
                message: "Parameter 'message' wajib diisi." 
            }, { status: 400 });
        }
        
        // Mock request object for controller
        const mockReq = { body };
        
        const result = await grokController(mockReq);
        return NextResponse.json(result);
    } catch (error) {
        // REKOMENDASI 2: Report detail ke Telegram (internal) tapi jangan bocor ke user
        reportError(error, { 
            endpoint: '/ai/grok', 
            method: 'POST',
            body: { message: '(sanitized)' } // jangan bocorkan isi pesan user
        }).catch(() => {});

        return NextResponse.json({ 
            success: false, 
            message: 'Layanan sedang sibuk. Silakan coba lagi nanti.' 
        }, { status: 500 });
    }
}
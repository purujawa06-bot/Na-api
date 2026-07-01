import { NextResponse } from 'next/server';
import imgbbController from '../../../../lib/controllers/tools/imgbb';
import { reportError } from '../../../../lib/errorLogger';

export async function POST(req) {
    try {
        const formData = await req.formData();
        const file = formData.get('image');

        if (!file || typeof file === 'string') {
            return NextResponse.json({ error: "Parameter 'image' wajib berupa file." }, { status: 400 });
        }

        const buffer = Buffer.from(await file.arrayBuffer());
        
        // Mock request object for controller
        const mockReq = { 
            fileBuffer: buffer, 
            fileName: file.name 
        };
        
        const result = await imgbbController(mockReq);
        return NextResponse.json(result);
    } catch (error) {
        // Auto-report error ke Telegram
        reportError(error, { endpoint: '/tools/imgbb', method: 'POST' }).catch(() => {});

        return NextResponse.json({ 
            success: false, 
            message: error.message 
        }, { status: 500 });
    }
}
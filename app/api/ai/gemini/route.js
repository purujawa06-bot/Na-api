import { NextResponse } from 'next/server';
import { askGemini } from '../../../../lib/gemini';
import { reportError } from '../../../../lib/errorLogger';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req) {
    try {
        const body = await req.json();
        const { prompt } = body;

        if (!prompt) {
            return NextResponse.json({ error: "Parameter 'prompt' wajib diisi." }, { status: 400 });
        }

        const answer = await askGemini(prompt);

        return NextResponse.json({
            success: true,
            author: 'PuruBoy',
            result: {
                answer: answer
            }
        });

    } catch (error) {
        // Auto-report error ke Telegram
        reportError(error, { endpoint: '/ai/gemini', method: 'POST' }).catch(() => {});

        return NextResponse.json({ 
            success: false,
            error: error.message 
        }, { status: 500 });
    }
}
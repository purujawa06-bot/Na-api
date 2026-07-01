import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import { reportError } from '../../../../../lib/errorLogger';

export const runtime = 'nodejs';
export const maxDuration = 60;

const client = new OpenAI({
    baseURL: 'https://betatestervueui2-b.hf.space/v1',
    apiKey: process.env.PURUAI_API_KEY || 'sk-00fa7c868847b760-fbkl9l-e4416500',
});

export async function POST(req) {
    try {
        const body = await req.json();
        const { messages } = body;

        if (!messages || !Array.isArray(messages)) {
            return NextResponse.json({ error: "Parameter 'messages' wajib diisi (array)." }, { status: 400 });
        }

        const completion = await client.chat.completions.create({
            model: 'puru',
            messages: [
                { role: 'system', content: `Kamu adalah ahli kompresi percakapan AI. 
Buat RINGKASAN KOMPRE yang akan dikirim ke AI lain sebagai konteks.
Aturan:
- Simpan SEMUA nama, angka, fakta, keputusan, preferensi user
- Simpan SEMUA pertanyaan user dan jawaban kunci AI
- Simpan konteks teknis, URL, kode, nama file
- Format bullet point padat
- Jangan buang detail penting apapun
- Tulis dalam bahasa Indonesia` },
                ...messages
            ],
            stream: false,
            max_tokens: 1024,
            temperature: 0.3,
            thinking: false,
        });

        const summary = completion?.choices?.[0]?.message?.content || '';

        return NextResponse.json({ success: true, summary });

    } catch (error) {
        // Auto-report error ke Telegram
        reportError(error, { endpoint: '/ai/puruai/compact', method: 'POST' }).catch(() => {});

        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

export async function OPTIONS(req) {
    return new Response(null, {
        headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        },
    });
}

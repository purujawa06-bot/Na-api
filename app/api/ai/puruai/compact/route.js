import { NextResponse } from 'next/server';
import OpenAI from 'openai';

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
                { role: 'system', content: 'Kamu adalah asisten yang membantu. Buat ringkasan yang padat dan informatif dari percakapan berikut.' },
                ...messages
            ],
            stream: false,
            max_tokens: 1024,
            temperature: 0.5,
            thinking: false,
        });

        const summary = completion?.choices?.[0]?.message?.content || '';

        return NextResponse.json({ success: true, summary });

    } catch (error) {
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

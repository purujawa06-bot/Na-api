import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const maxDuration = 60;

const API_BASE = 'https://hollow-isa-nue-api-a32469fb.koyeb.app/v1';
const API_KEY = proces…_KEY || 'sk-00f…6500';
const MODEL = 'puru';

export async function POST(req) {
    try {
        const body = await req.json();
        const { messages } = body;

        if (!messages || !Array.isArray(messages)) {
            return NextResponse.json({ error: "Parameter 'messages' wajib diisi (array)." }, { status: 400 });
        }

        const response = await fetch(`${API_BASE}/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${API_KEY}`,
            },
            body: JSON.stringify({
                model: MODEL,
                messages: [
                    { role: 'system', content: 'Kamu adalah asisten yang membantu. Buat ringkasan yang padat dan informatif dari percakapan berikut.' },
                    ...messages
                ],
                stream: false,
                max_tokens: 1024,
                temperature: 0.5,
            }),
        });

        if (!response.ok) {
            const errText = await response.text().catch(() => '');
            return NextResponse.json({ error: errText.substring(0, 200) }, { status: response.status });
        }

        const data = await response.json();
        const summary = data?.choices?.[0]?.message?.content || '';

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

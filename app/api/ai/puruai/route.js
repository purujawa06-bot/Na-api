import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import { reportError } from '../../../../lib/errorLogger';

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

        const stream = await client.chat.completions.create({
            model: 'puru',
            messages: [
                { role: 'system', content: 'Kamu adalah PuruAI, asisten AI yang ramah, cerdas, dan membantu. Jawab dengan bahasa Indonesia yang natural dan santai. Kamu adalah teman ngobrol yang asyik.' },
                ...messages
            ],
            stream: true,
            max_tokens: 2048,
            temperature: 0.7,
            thinking: false,
        });

        const encoder = new TextEncoder();
        const readableStream = new ReadableStream({
            async start(controller) {
                try {
                    for await (const chunk of stream) {
                        const content = chunk?.choices?.[0]?.delta?.content || '';
                        if (content) {
                            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content })}\n\n`));
                        }
                    }
                    controller.enqueue(encoder.encode('data: [DONE]\n\n'));
                    controller.close();
                } catch (err) {
        // Auto-report error ke Telegram
        reportError(err, { endpoint: '/ai/puruai', method: 'POST' }).catch(() => {});

                    controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: err.message })}\n\n`));
                    controller.close();
                }
            }
        });

        return new Response(readableStream, {
            headers: {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, Authorization',
            },
        });

    } catch (error) {
        // Auto-report error ke Telegram
        reportError(error, { endpoint: '/ai/puruai', method: 'UNKNOWN' }).catch(() => {});

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

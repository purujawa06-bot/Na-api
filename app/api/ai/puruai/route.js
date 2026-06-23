import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const maxDuration = 60;

const API_BASE = 'https://hollow-isa-nue-api-a32469fb.koyeb.app/v1';
const API_KEY = process.env.PURUAI_API_KEY || 'sk-00fa7c868847b760-fbkl9l-e4416500';
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
                    { role: 'system', content: 'Kamu adalah PuruAI, asisten AI yang ramah, cerdas, dan membantu. Jawab dengan bahasa Indonesia yang natural dan santai. Kamu adalah teman ngobrol yang asyik.' },
                    ...messages
                ],
                stream: true,
                max_tokens: 2048,
                temperature: 0.7,
            }),
        });

        if (!response.ok) {
            const errText = await response.text().catch(() => '');
            return NextResponse.json({ error: `API Error ${response.status}: ${errText.substring(0, 200)}` }, { status: response.status });
        }

        // Streaming response back to client
        const encoder = new TextEncoder();
        const readableStream = new ReadableStream({
            async start(controller) {
                try {
                    const reader = response.body.getReader();
                    const decoder = new TextDecoder();
                    let buffer = '';

                    while (true) {
                        const { done, value } = await reader.read();
                        if (done) break;

                        buffer += decoder.decode(value, { stream: true });
                        const lines = buffer.split('\n');
                        buffer = lines.pop() || '';

                        for (const line of lines) {
                            if (line.startsWith('data: ')) {
                                const data = line.slice(6).trim();
                                if (data === '[DONE]') continue;
                                try {
                                    const parsed = JSON.parse(data);
                                    const content = parsed?.choices?.[0]?.delta?.content || '';
                                    if (content) {
                                        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content })}\n\n`));
                                    }
                                } catch {}
                            }
                        }
                    }

                    if (buffer.startsWith('data: ')) {
                        const data = buffer.slice(6).trim();
                        if (data !== '[DONE]') {
                            try {
                                const parsed = JSON.parse(data);
                                const content = parsed?.choices?.[0]?.delta?.content || '';
                                if (content) {
                                    controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content })}\n\n`));
                                }
                            } catch {}
                        }
                    }

                    controller.enqueue(encoder.encode('data: [DONE]\n\n'));
                    controller.close();
                } catch (err) {
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

import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function POST(req) {
    try {
        const body = await req.json();
        const { message, model = 'deepseek/deepseek-v4-flash', history = [] } = body;

        if (!message) {
            return NextResponse.json({ error: "Parameter 'message' wajib diisi." }, { status: 400 });
        }

        const validModels = [
            'deepseek/deepseek-v4-flash',
            'deepseek/deepseek-r1',
            'deepseek/deepseek-v3.2'
        ];
        if (!validModels.includes(model)) {
            return NextResponse.json({
                error: `Model tidak valid. Pilihan: ${validModels.join(', ')}`
            }, { status: 400 });
        }

        const encoder = new TextEncoder();
        const customStream = new TransformStream();
        const writer = customStream.writable.getWriter();

        const send = (text) => {
            return writer.write(encoder.encode(text)).catch(() => {});
        };

        (async () => {
            try {
                await send(`Mengirim ke DeepSeek AI...\nModel: ${model}\nMessage: ${message}\n`);

                let fullContent = '';
                let fullReasoning = '';
                let reasoningBuffer = '';

                const DeepSeekV4 = require('../../../../../lib/deepseek-v4');
                const ds = new DeepSeekV4.DeepSeekV4();
                const stream = await ds.chat(message, { model, history });

                const flushReasoning = async () => {
                    if (reasoningBuffer.trim().length > 0) {
                        fullReasoning += reasoningBuffer;
                        await send(`🤔 ${reasoningBuffer.trim()}\n`);
                        reasoningBuffer = '';
                    }
                };

                // Collect raw chunks
                const chunks = [];
                for await (const rawChunk of stream) {
                    chunks.push(rawChunk.toString());
                }

                const fullText = chunks.join('');
                const lines = fullText.split('\n');

                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        const data = line.slice(6).trim();
                        if (data === '[DONE]') {
                            await flushReasoning();
                            break;
                        }
                        try {
                            const parsed = JSON.parse(data);
                            const delta = parsed.choices?.[0]?.delta || {};
                            if (delta.reasoning) {
                                reasoningBuffer += delta.reasoning;
                                if (reasoningBuffer.length >= 60) {
                                    await flushReasoning();
                                }
                            }
                            if (delta.content) {
                                await flushReasoning();
                                fullContent += delta.content;
                                await send(delta.content);
                            }
                        } catch (e) {}
                    }
                }

                await flushReasoning();

                if (!fullContent && !fullReasoning) {
                    await send(`[false] Gagal mendapatkan respons dari DeepSeek AI.`);
                } else {
                    const result = {
                        success: true,
                        result: {
                            content: fullContent,
                            reasoning: fullReasoning || null,
                            model: model,
                            source: 'deep-seek.ai'
                        }
                    };
                    await send(`[true] ${JSON.stringify(result)}`);
                }
            } catch (err) {
                await send(`[false] ${err.message}`);
            } finally {
                try { await writer.close(); } catch (e) {}
            }
        })();

        return new Response(customStream.readable, {
            headers: {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
            },
        });

    } catch (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

export async function GET(req) {
    return NextResponse.json({
        name: 'DeepSeek V4',
        description: 'DeepSeek chat via deep-seek.ai proxy (OpenRouter).',
        models: ['deepseek/deepseek-v4-flash', 'deepseek/deepseek-r1', 'deepseek/deepseek-v3.2'],
        usage: {
            method: 'POST',
            url: '/api/ai/deepseek/v4',
            body: {
                message: 'string (wajib) - Pesan untuk AI',
                model: 'string (opsional) - Model ID. Default: deepseek/deepseek-v4-flash',
                history: 'array (opsional) - Riwayat pesan [{role, content}]'
            }
        }
    });
}

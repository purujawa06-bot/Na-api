import { NextResponse } from 'next/server';
import { chatDeepSeekV4 } from '../../../../../lib/deepseek-v4';

export const runtime = 'nodejs';

export async function POST(req) {
    try {
        const body = await req.json();
        const { message, model = 'deepseek/deepseek-v4-flash', history = [] } = body;

        if (!message) {
            return NextResponse.json({ error: "Parameter 'message' wajib diisi." }, { status: 400 });
        }

        // Validasi model
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

                const DeepSeekV4 = require('../../../../../lib/deepseek-v4');
                const ds = new DeepSeekV4.DeepSeekV4();
                const stream = await ds.chat(message, { model, history });

                // Parse SSE stream
                const buffer = [];
                let currentEvent = '';

                for await (const rawChunk of stream) {
                    const text = typeof rawChunk === 'object' && rawChunk[Symbol.asyncIterator]
                        ? await (async () => { let r = ''; for await (const c of rawChunk) r += c.toString(); return r; })()
                        : rawChunk.toString();
                    
                    const lines = text.split('\n');
                    for (const line of lines) {
                        if (line.startsWith('event: ')) {
                            currentEvent = line.slice(7).trim();
                            continue;
                        }
                        if (line.startsWith('data: ')) {
                            const data = line.slice(6);
                            if (data === '[DONE]') break;
                            try {
                                const parsed = JSON.parse(data);
                                const delta = parsed.choices?.[0]?.delta || {};
                                if (delta.reasoning) {
                                    fullReasoning += delta.reasoning;
                                    await send(`🤔 ${delta.reasoning}`);
                                }
                                if (delta.content) {
                                    fullContent += delta.content;
                                    await send(delta.content);
                                }
                            } catch (e) {}
                            currentEvent = '';
                        }
                    }
                }

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

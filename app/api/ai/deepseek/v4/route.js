import { NextResponse } from 'next/server';
import { reportError } from '../../../../../lib/errorLogger';

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

        const DeepSeekV4 = require('../../../../../lib/deepseek-v4');
        const ds = new DeepSeekV4.DeepSeekV4();
        const stream = await ds.chat(message, { model, history });

        // Collect all SSE chunks
        const chunks = [];
        for await (const rawChunk of stream) {
            chunks.push(rawChunk.toString());
        }

        const fullText = chunks.join('');
        const lines = fullText.split('\n');

        let reasoning = '';
        let content = '';

        for (const line of lines) {
            if (line.startsWith('data: ')) {
                const data = line.slice(6).trim();
                if (data === '[DONE]') break;
                try {
                    const parsed = JSON.parse(data);
                    const delta = parsed.choices?.[0]?.delta || {};
                    if (delta.reasoning) reasoning += delta.reasoning;
                    if (delta.content) content += delta.content;
                } catch (e) {
        // Auto-report error ke Telegram
        reportError(e, { endpoint: '/ai/deepseek/v4', method: 'POST' }).catch(() => {});
}
            }
        }

        return NextResponse.json({
            success: true,
            result: {
                content: content || null,
                reasoning: reasoning || null,
                model: model,
                source: 'deep-seek.ai'
            }
        });

    } catch (error) {
        // Auto-report error ke Telegram
        reportError(error, { endpoint: '/ai/deepseek/v4', method: 'UNKNOWN' }).catch(() => {});

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

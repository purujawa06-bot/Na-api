import { NextResponse } from 'next/server';
import { chatCompletion } from '../../../../lib/puru';
import puruController from '../../../../lib/controllers/ai/puru';

export const runtime = 'nodejs';
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

export async function POST(req) {
    try {
        const body = await req.json();
        const mockReq = { body };
        const controllerResult = await puruController(mockReq);

        // If controller signals streaming, handle it here
        if (controllerResult && controllerResult.stream) {
            const { messages, max_tokens, temperature } = controllerResult;

            const encoder = new TextEncoder();
            const customStream = new TransformStream();
            const writer = customStream.writable.getWriter();

            const send = (data) => {
                return writer.write(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
            };

            (async () => {
                try {
                    const generator = await chatCompletion(messages, {
                        stream: true,
                        max_tokens: max_tokens || 2048,
                        temperature: temperature || 0.7,
                    });

                    for await (const chunk of generator) {
                        await send(chunk);
                    }
                    await send({ type: 'finish' });
                } catch (err) {
                    await send({ type: 'error', content: err.message });
                } finally {
                    try { await writer.close(); } catch (e) { /* ignore */ }
                }
            })();

            return new Response(customStream.readable, {
                headers: {
                    'Content-Type': 'text/event-stream',
                    'Cache-Control': 'no-cache',
                    'Connection': 'keep-alive',
                },
            });
        }

        // Non-streaming: return standard envelope
        return NextResponse.json(controllerResult);

    } catch (error) {
        return NextResponse.json({
            success: false,
            message: error.message,
        }, { status: 500 });
    }
}

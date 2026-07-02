import { chat } from '../../../../lib/geminiV2';
import { askGemini } from '../../../../lib/gemini';
import { reportError } from '../../../../lib/errorLogger';

export const runtime = 'nodejs';
export const maxDuration = 120;

/**
 * @title PuruAI with Gemini V2 + V1 Fallback (SSE Streaming)
 * @summary AI chat endpoint with automatic fallback: V2 -> V1 -> V2 -> V1 (max 4 attempts)
 * @description Menggunakan Gemini V2 sebagai primary, dengan fallback ke Gemini V1.
 *   Akan mengulang pola V2->V1 hingga maksimal 4x percobaan.
 *   Output dalam format SSE (Server-Sent Events) untuk kompatibilitas dengan page.
 * @method POST
 * @path /api/ai/puruai
 * @response sse
 * @param {string|object} body - { prompt: "..." } atau { messages: [...] }
 */
export async function POST(req) {
    try {
        const body = await req.json();

        // Support both formats:
        // 1. { prompt: "..." } — direct prompt
        // 2. { messages: [{ role, content }, ...] } — OpenAI format (used by page)
        let prompt;
        if (body.prompt) {
            prompt = body.prompt;
        } else if (body.messages && Array.isArray(body.messages)) {
            const lastUserMsg = [...body.messages].reverse().find(m => m.role === 'user');
            prompt = lastUserMsg?.content;
        }

        if (!prompt) {
            const errorMsg = "Parameter 'prompt' atau 'messages' (array) wajib diisi.";
            const encoder = new TextEncoder();
            return new Response(new ReadableStream({
                start(controller) {
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: errorMsg })}\n\n`));
                    controller.enqueue(encoder.encode('data: [DONE]\n\n'));
                    controller.close();
                }
            }), {
                headers: {
                    'Content-Type': 'text/event-stream',
                    'Cache-Control': 'no-cache',
                    'Connection': 'keep-alive',
                    'Access-Control-Allow-Origin': '*',
                },
            });
        }

        // SSE streaming response dengan fallback V2->V1->V2->V1
        const encoder = new TextEncoder();
        const readableStream = new ReadableStream({
            async start(controller) {
                try {
                    let answer = null;
                    let lastError = null;
                    const maxAttempts = 4;

                    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
                        const isV2 = attempt % 2 === 1; // Odd = V2, Even = V1
                        const modelName = isV2 ? 'Gemini V2' : 'Gemini V1';

                        try {
                            console.log(`[PuruAI] Attempt ${attempt}/${maxAttempts} — using ${modelName}`);

                            if (isV2) {
                                answer = await chat(prompt);
                            } else {
                                answer = await askGemini(prompt);
                            }

                            // Success!
                            break;

                        } catch (err) {
                            lastError = err;
                            console.log(`[PuruAI] Attempt ${attempt} (${modelName}) failed: ${err.message}`);

                            if (attempt < maxAttempts) {
                                // Kirim notif fallback ke client (opsional)
                                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ 
                                    content: `\n\n_${modelName} gagal, fallback ke ${attempt + 1 === 2 ? 'Gemini V1' : attempt + 1 === 3 ? 'Gemini V2' : 'Gemini V1'}..._\n\n`
                                })}\n\n`));
                                continue;
                            }
                        }
                    }

                    if (answer) {
                        // Kirim full answer sebagai SSE
                        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: answer })}\n\n`));
                    } else {
                        // All attempts failed
                        const errMsg = `⚠️ Semua percobaan gagal setelah ${maxAttempts}x. Error: ${lastError?.message || 'Unknown'}`;
                        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ 
                            content: errMsg 
                        })}\n\n`));
                        
                        // Auto-report
                        reportError(lastError || new Error(errMsg), { 
                            endpoint: '/ai/puruai', 
                            method: 'POST' 
                        }).catch(() => {});
                    }

                    controller.enqueue(encoder.encode('data: [DONE]\n\n'));
                    controller.close();

                } catch (err) {
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: err.message })}\n\n`));
                    controller.enqueue(encoder.encode('data: [DONE]\n\n'));
                    controller.close();

                    reportError(err, { endpoint: '/ai/puruai', method: 'POST' }).catch(() => {});
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
        reportError(error, { endpoint: '/ai/puruai', method: 'UNKNOWN' }).catch(() => {});

        const encoder = new TextEncoder();
        return new Response(new ReadableStream({
            start(controller) {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: error.message })}\n\n`));
                controller.enqueue(encoder.encode('data: [DONE]\n\n'));
                controller.close();
            }
        }), {
            headers: {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
                'Access-Control-Allow-Origin': '*',
            },
        });
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

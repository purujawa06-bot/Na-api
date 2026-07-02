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

        // Extract system prompt (dari page atau default)
        const systemPrompt = body.systemPrompt || `Kamu adalah PuruAI, asisten AI yang ramah, natural, dan membantu. 
Gunakan bahasa Indonesia yang santai dan alami seperti teman ngobrol, bukan robot kaku.
Ciri-ciri responsmu:
- Gunakan bahasa sehari-hari yang natural, bukan bahasa formal kaku
- Sesekali gunakan slang ringan yang wajar (santai, gitu, banget, dll)
- Jawab dengan hangat dan peduli, seperti teman yang ngobrol
- Jangan terlalu kaku atau terlalu formal
- Berikan informasi yang akurat tapi dengan gaya yang enak dibaca
- Jika ditanya hal teknis, jelaskan dengan cara yang mudah dimengerti
- Gunakan emoji secukupnya untuk menambah kehangatan (👍😄🔥 dll)
- Akui jika tidak tahu, jangan mengarang jawaban`;

        // Build the final prompt from messages
        let finalPrompt = '';

        if (body.prompt) {
            // Direct prompt mode — just use as-is
            finalPrompt = body.prompt;
        } else if (body.messages && Array.isArray(body.messages)) {
            // Messages array mode — reconstruct full conversation context

            // Separate system messages from conversation
            const sysMessages = body.messages.filter(m => m.role === 'system');
            const conversationMessages = body.messages.filter(m => m.role !== 'system');

            // Use custom system prompt from messages if available
            const customSysPrompt = sysMessages.map(m => m.content).join('\n');
            const effectiveSystemPrompt = customSysPrompt || systemPrompt;

            // Build conversation history text
            const conversationLines = conversationMessages.map(m => {
                const speaker = m.role === 'user' ? 'User' : 'PuruAI';
                return `${speaker}: ${m.content}`;
            }).join('\n');

            // Find the last user message as the current question
            const lastUserMsg = [...conversationMessages].reverse().find(m => m.role === 'user');
            const currentQuestion = lastUserMsg?.content || '';

            // Everything except the last user message is context
            const contextLines = conversationMessages.slice(0, -1).map(m => {
                const speaker = m.role === 'user' ? 'User' : 'PuruAI';
                return `${speaker}: ${m.content}`;
            }).join('\n');

            // Construct prompt with system instructions + context + current question
            if (contextLines) {
                finalPrompt = `${effectiveSystemPrompt}

=== RIWAYAT PERCAKAPAN ===
${contextLines}

=== PERTANYAAN BARU ===
User: ${currentQuestion}

PuruAI:`;
            } else {
                // No history — just system + question
                finalPrompt = `${effectiveSystemPrompt}

User: ${currentQuestion}

PuruAI:`;
            }
        }

        if (!finalPrompt) {
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
                                answer = await chat(finalPrompt);
                            } else {
                                answer = await askGemini(finalPrompt);
                            }

                            // Success!
                            break;

                        } catch (err) {
                            lastError = err;
                            console.log(`[PuruAI] Attempt ${attempt} (${modelName}) failed: ${err.message}`);

                            if (attempt < maxAttempts) {
                                // Kirim notif fallback ke client
                                const nextModel = attempt + 1 === 2 ? 'Gemini V1' : attempt + 1 === 3 ? 'Gemini V2' : 'Gemini V1';
                                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ 
                                    content: `\n\n_${modelName} gagal, fallback ke ${nextModel}..._\n\n`
                                })}\n\n`));
                                continue;
                            }
                        }
                    }

                    if (answer) {
                        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: answer })}\n\n`));
                    } else {
                        const errMsg = `⚠️ Semua percobaan gagal setelah ${maxAttempts}x. Error: ${lastError?.message || 'Unknown'}`;
                        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: errMsg })}\n\n`));

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

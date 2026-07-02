import { NextResponse } from 'next/server';
import { chat } from '../../../../lib/geminiV2';
import { askGemini } from '../../../../lib/gemini';
import { reportError } from '../../../../lib/errorLogger';

export const runtime = 'nodejs';
export const maxDuration = 120;

/**
 * @title PuruAI with Gemini V2 + V1 Fallback
 * @summary AI chat endpoint with automatic fallback: V2 -> V1 -> V2 -> V1 (max 4 attempts)
 * @description Menggunakan Gemini V2 sebagai primary, dengan fallback ke Gemini V1.
 *   Akan mengulang pola V2->V1 hingga maksimal 4x percobaan.
 * @method POST
 * @path /api/ai/puruai
 * @response json
 * @param {string} body.prompt - Pertanyaan yang ingin diajukan.
 */
export async function POST(req) {
    try {
        const body = await req.json();
        const { prompt } = body;

        if (!prompt) {
            return NextResponse.json({ 
                error: "Parameter 'prompt' wajib diisi." 
            }, { status: 400 });
        }

        let lastError = null;
        const maxAttempts = 4;

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            const isV2 = attempt % 2 === 1; // Odd = V2, Even = V1
            const modelName = isV2 ? 'Gemini V2' : 'Gemini V1';

            try {
                console.log(`[PuruAI] Attempt ${attempt}/${maxAttempts} — using ${modelName}`);

                let answer;
                if (isV2) {
                    answer = await chat(prompt);
                } else {
                    answer = await askGemini(prompt);
                }

                // Success — return result
                return NextResponse.json({
                    success: true,
                    author: 'PuruBoy',
                    model: modelName,
                    attempt: attempt,
                    result: {
                        answer: answer
                    }
                });

            } catch (err) {
                lastError = err;
                console.log(`[PuruAI] Attempt ${attempt} (${modelName}) failed: ${err.message}`);

                // If not last attempt, continue to next fallback
                if (attempt < maxAttempts) {
                    continue;
                }
            }
        }

        // All 4 attempts failed
        throw new Error(`Semua percobaan gagal setelah ${maxAttempts}x attempt. Error terakhir: ${lastError?.message}`);

    } catch (error) {
        // Auto-report error ke Telegram
        reportError(error, { endpoint: '/ai/puruai', method: 'POST' }).catch(() => {});

        return NextResponse.json({ 
            success: false,
            error: error.message 
        }, { status: 500 });
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

import { NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs';
import { generateFluxV2 } from '../../../../lib/flux-v2';
import { reportError } from '../../../../lib/errorLogger';


export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Keep-alive facts
const FACTS = [
    "FLUX Pro adalah model generasi gambar dari Black Forest Labs.",
    "HF Space ini adalah Fake FLUX Pro Unlimited.",
    "Gambar dihasilkan dalam ~2-3 detik jika tidak ada antrian.",
    "Gratis tanpa perlu API key!",
    "Semakin detail prompt, semakin bagus hasilnya.",
    "Model 'turbo' adalah yang tercepat.",
];

// Anti-spam: map IP → timestamp terakhir request
const requestLog = new Map();

function isRateLimited(ip) {
    const now = Date.now();
    const last = requestLog.get(ip);
    if (last && (now - last) < 15000) { // 15 detik cooldown
        return true;
    }
    requestLog.set(ip, now);
    return false;
}

export async function POST(req) {
    try {
        const body = await req.json();
        const { prompt, model = 'turbo' } = body;
        
        if (!prompt) {
            return NextResponse.json({ error: "Parameter 'prompt' wajib diisi." }, { status: 400 });
        }

        // Rate limit sederhana
        const ip = req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || 'unknown';
        if (isRateLimited(ip + ':flux-v2')) {
            return NextResponse.json({ 
                error: "⏳ Mohon tunggu 15 detik sebelum request lagi. HF Space punya antrian."
            }, { status: 429 });
        }

        const encoder = new TextEncoder();
        
        const customStream = new TransformStream();
        const writer = customStream.writable.getWriter();

        const send = (text) => {
            return writer.write(encoder.encode(text)).catch(() => {});
        };

        // Process in background
        (async () => {
            let keepAliveInterval;
            try {
                await send(`Menghubungkan ke Fake FLUX Pro Unlimited...\nGenerating: "${prompt}"\nModel: ${model}\n`);

                // Keep-alive setiap 3 detik biar koneksi gak putus
                keepAliveInterval = setInterval(() => {
                    const fact = FACTS[Math.floor(Math.random() * FACTS.length)];
                    send(`Info: ${fact}\n`);
                }, 3000);

                const result = await generateFluxV2(prompt);
                
                clearInterval(keepAliveInterval);

                if (result.success) {
                    const origin = new URL(req.url).origin;
                    let imageUrl = result.result.url;
                    if (imageUrl.startsWith('/')) {
                        imageUrl = origin + imageUrl;
                    }
                    await send(`[true] ${imageUrl}`);
                } else {
                    await send(`[false] Gagal menghasilkan gambar.`);
                }
            } catch (err) {
        // Auto-report error ke Telegram
        reportError(err, { endpoint: '/ai/flux-v2', method: 'POST' }).catch(() => {});

                if (keepAliveInterval) clearInterval(keepAliveInterval);
                await send(`[false] ${err.message}`);
            } finally {
                try {
                    await writer.close();
                } catch (e) {
        // Auto-report error ke Telegram
        reportError(e, { endpoint: '/ai/flux-v2', method: 'UNKNOWN' }).catch(() => {});
}
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
        // Auto-report error ke Telegram
        reportError(error, { endpoint: '/ai/flux-v2', method: 'UNKNOWN' }).catch(() => {});

        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

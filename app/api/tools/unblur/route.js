import { NextResponse } from 'next/server';
import unblur from '../../../../lib/unblur';
import { uploadToTmp } from '../../../../lib/uploader';
import tempService from '../../../../lib/tempService';
import { reportError } from '../../../../lib/errorLogger';


export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 120; // Unblur processing can be slow

const FACTS = [
    "AI Unblur mendeteksi distorsi piksel dan merekonstruksi tepian objek.",
    "Blur pada foto sering disebabkan oleh guncangan kamera atau fokus yang meleset.",
    "Proses dekonvolusi digunakan oleh AI untuk mengembalikan detail asli.",
    "Semakin tinggi resolusi awal, semakin baik hasil restorasi AI.",
    "Teknologi ini sering digunakan dalam forensik digital untuk memperjelas barang bukti."
];

export async function POST(req) {
    try {
        const body = await req.json();
        const { url } = body;
        
        if (!url) {
            return NextResponse.json({ error: "Parameter 'url' wajib diisi." }, { status: 400 });
        }

        const origin = new URL(req.url).origin;
        const encoder = new TextEncoder();
        const customStream = new TransformStream();
        const writer = customStream.writable.getWriter();

        const send = (text) => {
            return writer.write(encoder.encode(text)).catch(() => {});
        };

        (async () => {
            let keepAliveInterval;
            try {
                await send("Menganalisis tingkat keburaman dan membuat antrean...\n");

                keepAliveInterval = setInterval(() => {
                    const fact = FACTS[Math.floor(Math.random() * FACTS.length)];
                    send(`Info: ${fact}\n`);
                }, 3000);

                const resultBuffer = await unblur.process(url);
                
                clearInterval(keepAliveInterval);
                await send("Pemrosesan selesai! Mengunggah hasil...\n");

                const proxyPath = await uploadToTmp(resultBuffer, `unblur-${Date.now()}.png`);
                
                const dbId = await tempService.save({
                    output: origin + proxyPath,
                    original: url,
                    author: 'PuruBoy'
                }, 30);

                await send(`[true] ${origin}/api/temp/${dbId}`);
            } catch (err) {
        // Auto-report error ke Telegram
        reportError(err, { endpoint: '/tools/unblur', method: 'POST' }).catch(() => {});

                if (keepAliveInterval) clearInterval(keepAliveInterval);
                await send(`[false] ${err.message}`);
            } finally {
                try { await writer.close(); } catch (e) {
        // Auto-report error ke Telegram
        reportError(e, { endpoint: '/tools/unblur', method: 'UNKNOWN' }).catch(() => {});
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
        reportError(error, { endpoint: '/tools/unblur', method: 'UNKNOWN' }).catch(() => {});

        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
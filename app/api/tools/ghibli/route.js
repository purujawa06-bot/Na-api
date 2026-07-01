import { NextResponse } from 'next/server';
import { ghibli } from '../../../../lib/ghibli';
import tempService from '../../../../lib/tempService';
import { reportError } from '../../../../lib/errorLogger';


export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60; 

const FACTS = [
    "Studio Ghibli didirikan pada tahun 1985.",
    "Hayao Miyazaki awalnya ingin pensiun setelah Princess Mononoke.",
    "Spirited Away adalah film anime pertama yang memenangkan Oscar.",
    "Totoro menjadi maskot resmi Studio Ghibli.",
    "Ghibli diambil dari nama pesawat Italia 'Ghibli'.",
    "Warna-warna Ghibli dikenal lembut dan menenangkan.",
    "Museum Ghibli terletak di Mitaka, Tokyo."
];

export async function POST(req) {
    try {
        const body = await req.json();
        const { url, prompt } = body;
        
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
                await send(`Memproses gambar ke gaya Ghibli...\n`);

                keepAliveInterval = setInterval(() => {
                    const fact = FACTS[Math.floor(Math.random() * FACTS.length)];
                    send(`Info: ${fact}\n`);
                }, 2000);

                const result = await ghibli.process(url, prompt);
                
                clearInterval(keepAliveInterval);

                if (result.success) {
                    const dbId = await tempService.save({
                        output: origin + result.image,
                        original: url,
                        source: 'ghibli-ai'
                    }, 30);
                    
                    await send(`[true] ${origin}/api/temp/${dbId}`);
                } else {
                    await send(`[false] ${result.error || 'Gagal memproses gambar.'}`);
                }
            } catch (err) {
        // Auto-report error ke Telegram
        reportError(err, { endpoint: '/tools/ghibli', method: 'POST' }).catch(() => {});

                if (keepAliveInterval) clearInterval(keepAliveInterval);
                await send(`[false] ${err.message}`);
            } finally {
                try { await writer.close(); } catch (e) {
        // Auto-report error ke Telegram
        reportError(e, { endpoint: '/tools/ghibli', method: 'UNKNOWN' }).catch(() => {});
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
        reportError(error, { endpoint: '/tools/ghibli', method: 'UNKNOWN' }).catch(() => {});

        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
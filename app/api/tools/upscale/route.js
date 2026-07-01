import { NextResponse } from 'next/server';
import { upscale } from '../../../../lib/upscale';
import tempService from '../../../../lib/tempService';
import { reportError } from '../../../../lib/errorLogger';


export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60; // Proses upscale bisa memakan waktu

const FACTS = [
    "AI Upscale merekonstruksi detail yang hilang dari gambar resolusi rendah.",
    "Proses ini menggunakan Deep Learning Neural Networks.",
    "Cloudinary memproses jutaan gambar setiap harinya.",
    "Gambar dengan resolusi lebih tinggi memiliki lebih banyak piksel per inci (PPI).",
    "Upscaling digital tradisional (bicubic) seringkali membuat gambar buram, beda dengan AI."
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
                await send("Memulai proses Upscale...\n");

                // Timer Keep-Alive
                keepAliveInterval = setInterval(() => {
                    const fact = FACTS[Math.floor(Math.random() * FACTS.length)];
                    send(`Info: ${fact}\n`);
                }, 2000);

                const result = await upscale.process(url);
                
                clearInterval(keepAliveInterval);

                if (result.success) {
                    const outputData = {
                        output: origin + result.image,
                        original: url,
                        source: 'cloudinary-upscale'
                    };
                    const dbId = await tempService.save(outputData, 30);
                    // Format sukses: [true] link_proxy
                    await send(`[true] ${origin}/api/temp/${dbId}`);
                } else {
                    await send(`[false] ${result.error || 'Gagal melakukan upscale.'}`);
                }
            } catch (err) {
        // Auto-report error ke Telegram
        reportError(err, { endpoint: '/tools/upscale', method: 'POST' }).catch(() => {});

                if (keepAliveInterval) clearInterval(keepAliveInterval);
                await send(`[false] ${err.message}`);
            } finally {
                try { await writer.close(); } catch (e) {
        // Auto-report error ke Telegram
        reportError(e, { endpoint: '/tools/upscale', method: 'UNKNOWN' }).catch(() => {});
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
        reportError(error, { endpoint: '/tools/upscale', method: 'UNKNOWN' }).catch(() => {});

        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
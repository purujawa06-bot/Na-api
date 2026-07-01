import { NextResponse } from 'next/server';
import { convertMp4ToMp3 } from '../../../../lib/mp4tomp3';
import tempService from '../../../../lib/tempService';
import { reportError } from '../../../../lib/errorLogger';


export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 120;

const FACTS = [
    "MP3 menggunakan kompresi 'lossy' untuk memperkecil ukuran file.",
    "Format MP4 dapat menyimpan audio, video, dan subtitle sekaligus.",
    "Konversi bit-rate tinggi menghasilkan kualitas audio yang lebih jernih.",
    "FreeConvert memproses ribuan file setiap menitnya.",
    "Audio tanpa video menghemat ruang penyimpanan hingga 90%."
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
                await send("Mendaftarkan antrean konversi MP4 ke MP3...\n");

                const job = await convertMp4ToMp3(url);
                
                keepAliveInterval = setInterval(() => {
                    const fact = FACTS[Math.floor(Math.random() * FACTS.length)];
                    send(`Sambil menunggu... ${fact}\n`);
                }, 3000);

                let downloadLink = null;
                let attempts = 0;
                const maxAttempts = 30;

                while (attempts < maxAttempts) {
                    const status = await job.checkStatus();
                    if (status.status === 'completed') {
                        downloadLink = status.url;
                        break;
                    }
                    attempts++;
                    await new Promise(r => setTimeout(r, 3000));
                }

                clearInterval(keepAliveInterval);

                if (downloadLink) {
                    const dbId = await tempService.save({
                        output: downloadLink,
                        original: url,
                        type: 'audio/mp3',
                        author: 'PuruBoy'
                    }, 30);
                    await send(`[true] ${origin}/api/temp/${dbId}`);
                } else {
                    await send(`[false] Timeout atau konversi gagal.`);
                }
            } catch (err) {
        // Auto-report error ke Telegram
        reportError(err, { endpoint: '/tools/mp4tomp3', method: 'POST' }).catch(() => {});

                if (keepAliveInterval) clearInterval(keepAliveInterval);
                await send(`[false] ${err.message}`);
            } finally {
                try { await writer.close(); } catch (e) {
        // Auto-report error ke Telegram
        reportError(e, { endpoint: '/tools/mp4tomp3', method: 'UNKNOWN' }).catch(() => {});
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
        reportError(error, { endpoint: '/tools/mp4tomp3', method: 'UNKNOWN' }).catch(() => {});

        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
import { NextResponse } from 'next/server';
import M3U8ToMP4Converter from '../../../../lib/m3u8';
import tempService from '../../../../lib/tempService';
import { reportError } from '../../../../lib/errorLogger';


export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300; // Konversi video bisa sangat lama

const FACTS = [
    "M3U8 adalah format playlist untuk Apple HTTP Live Streaming (HLS).",
    "Konversi MP4 dari streaming bekerja dengan menggabungkan ribuan file .ts kecil.",
    "Layanan ini memproses stream secara paralel untuk kecepatan maksimal.",
    "File MP4 hasil konversi memiliki kompatibilitas tinggi di semua perangkat.",
    "Semakin tinggi bitrate video asli, semakin besar ukuran file MP4 hasil konversi.",
    "Server kami melakukan transcoding secara otomatis jika diperlukan."
];

export async function POST(req) {
    try {
        const body = await req.json();
        const { url } = body;
        
        if (!url) {
            return NextResponse.json({ error: "Parameter 'url' playlist M3U8 wajib diisi." }, { status: 400 });
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
                await send("Menghubungkan ke Conversion Engine...\n");

                const converter = new M3U8ToMP4Converter();
                const jobId = await converter.createJob(url);
                
                await send(`Antrean dibuat (Job ID: ${jobId}). Memulai proses penggabungan fragmen...\n`);

                keepAliveInterval = setInterval(() => {
                    const fact = FACTS[Math.floor(Math.random() * FACTS.length)];
                    send(`Proses sedang berjalan... ${fact}\n`);
                }, 4000);

                let result = null;
                let attempts = 0;
                const maxAttempts = 100; // Toleransi waktu tunggu tinggi

                while (attempts < maxAttempts) {
                    const check = await converter.checkJobStatus(jobId);
                    
                    if (check.status === 'completed') {
                        result = check;
                        break;
                    } else if (check.status === 'error' || check.status === 'missing') {
                        throw new Error("Gagal mengonversi video. Server m3u8-to-mp4 menolak permintaan.");
                    }
                    
                    attempts++;
                    await new Promise(r => setTimeout(r, 5000));
                }

                clearInterval(keepAliveInterval);

                if (result) {
                    const dbId = await tempService.save({
                        output: result.downloadUrl,
                        original: url,
                        filename: result.filename,
                        type: 'video/mp4',
                        author: 'Tiyanz'
                    }, 30);
                    
                    await send(`[true] ${origin}/api/temp/${dbId}`);
                } else {
                    await send(`[false] Timeout: Video terlalu panjang atau server sedang sibuk.`);
                }
            } catch (err) {
        // Auto-report error ke Telegram
        reportError(err, { endpoint: '/tools/m3u8', method: 'POST' }).catch(() => {});

                if (keepAliveInterval) clearInterval(keepAliveInterval);
                await send(`[false] ${err.message}`);
            } finally {
                try { await writer.close(); } catch (e) {
        // Auto-report error ke Telegram
        reportError(e, { endpoint: '/tools/m3u8', method: 'UNKNOWN' }).catch(() => {});
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
        reportError(error, { endpoint: '/tools/m3u8', method: 'UNKNOWN' }).catch(() => {});

        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
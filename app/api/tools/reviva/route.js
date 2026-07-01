import { NextResponse } from 'next/server';
import { imggenColorize } from '../../../../lib/imggenColorize';
import tempService from '../../../../lib/tempService';
import { reportError } from '../../../../lib/errorLogger';


export const dynamic = 'force-dynamic';
const FACTS = [
    "AI mewarnai foto dengan menganalisis tekstur dan konteks objek.",
    "Warna kulit manusia dan dedaunan adalah hal termudah bagi AI untuk dikenali.",
    "Foto hitam putih sebenarnya menyimpan informasi kontras yang sangat detail.",
    "Proses ini menggunakan Generative Adversarial Networks (GAN).",
    "Mewarnai satu foto secara manual oleh profesional bisa memakan waktu berjam-jam.",
    "Lidah jerapah berwarna biru hitam.",
    "Otak manusia bekerja lebih aktif saat tidur daripada saat menonton TV."
];

export const runtime = 'nodejs';
export const maxDuration = 60;

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
                await send("Menghubungkan ke AI Engine V2...\n");

                keepAliveInterval = setInterval(() => {
                    const fact = FACTS[Math.floor(Math.random() * FACTS.length)];
                    send(`Info: ${fact}\n`);
                }, 2000);

                const result = await imggenColorize.process(url);
                
                clearInterval(keepAliveInterval);

                if (result.success) {
                    const dbId = await tempService.save({
                        output: result.image,
                        original: url,
                        engine: 'imggen-v2'
                    }, 30);
                    await send(`[true] ${origin}/api/temp/${dbId}`);
                } else {
                    await send(`[false] ${result.error || 'Gagal mewarnai gambar.'}`);
                }
            } catch (err) {
        // Auto-report error ke Telegram
        reportError(err, { endpoint: '/tools/reviva', method: 'POST' }).catch(() => {});

                if (keepAliveInterval) clearInterval(keepAliveInterval);
                await send(`[false] ${err.message}`);
            } finally {
                try { await writer.close(); } catch (e) {
        // Auto-report error ke Telegram
        reportError(e, { endpoint: '/tools/reviva', method: 'UNKNOWN' }).catch(() => {});
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
        reportError(error, { endpoint: '/tools/reviva', method: 'UNKNOWN' }).catch(() => {});

        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
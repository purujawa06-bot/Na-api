import { NextResponse } from 'next/server';
import { generateVideo } from '../../../../lib/grimore';
import { uploadToTmp } from '../../../../lib/uploader';
import tempService from '../../../../lib/tempService';
import { reportError } from '../../../../lib/errorLogger';


export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 120;

const FACTS = [
    "Video promosi yang menarik dapat meningkatkan konversi hingga 80%.",
    "Manusia memproses informasi visual 60.000 kali lebih cepat daripada teks.",
    "Warna merah sering digunakan untuk memicu rasa urgensi dalam promosi.",
    "Video vertikal kini lebih populer karena penggunaan smartphone yang masif.",
    "Branding yang konsisten membantu audiens mengenali merek Anda lebih cepat.",
    "Rendering video di cloud memerlukan daya komputasi yang besar.",
    "Tahukah Anda? Nama Ghibli terinspirasi dari angin gurun yang panas."
];

export async function POST(req) {
    try {
        const body = await req.json();
        const { bgUrl, humanUrl, brand, title, slogan, promo, wm } = body;
        
        if (!bgUrl || !humanUrl || !brand || !title) {
            return NextResponse.json({ error: "Parameter bgUrl, humanUrl, brand, dan title wajib diisi." }, { status: 400 });
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
                await send("Mempersiapkan aset dan memulai proses rendering video ubur-ubur...\n");

                keepAliveInterval = setInterval(() => {
                    const fact = FACTS[Math.floor(Math.random() * FACTS.length)];
                    send(`Sambil menunggu... ${fact}\n`);
                }, 3000);

                const videoBuffer = await generateVideo({ bgUrl, humanUrl, brand, title, slogan, promo, wm });
                
                clearInterval(keepAliveInterval);
                await send("Rendering selesai! Mengunggah video ke server publik...\n");

                const proxyPath = await uploadToTmp(videoBuffer, `uburubur-${Date.now()}.mp4`);
                
                const dbId = await tempService.save({
                    output: origin + proxyPath,
                    type: 'video/mp4',
                    author: 'PuruBoy'
                }, 30);

                await send(`[true] ${origin}/api/temp/${dbId}`);
            } catch (err) {
        // Auto-report error ke Telegram
        reportError(err, { endpoint: '/meme/uburubur', method: 'POST' }).catch(() => {});

                if (keepAliveInterval) clearInterval(keepAliveInterval);
                await send(`[false] ${err.message}`);
            } finally {
                try { await writer.close(); } catch (e) {
        // Auto-report error ke Telegram
        reportError(e, { endpoint: '/meme/uburubur', method: 'UNKNOWN' }).catch(() => {});
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
        reportError(error, { endpoint: '/meme/uburubur', method: 'UNKNOWN' }).catch(() => {});

        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
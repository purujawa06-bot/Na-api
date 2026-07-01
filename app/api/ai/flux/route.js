import { NextResponse } from 'next/server';
import { generateFluxV2 } from '../../../../lib/flux-v2';
import { reportError } from '../../../../lib/errorLogger';


export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Anti-spam: map IP → timestamp terakhir request
const requestLog = new Map();

function isRateLimited(ip) {
    const now = Date.now();
    const last = requestLog.get(ip);
    if (last && (now - last) < 15000) {
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

        // Rate limit
        const ip = req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || 'unknown';
        if (isRateLimited(ip + ':flux')) {
            return NextResponse.json({
                error: "⏳ Mohon tunggu 15 detik sebelum request lagi."
            }, { status: 429 });
        }

        const result = await generateFluxV2(prompt);

        if (result.success) {
            const origin = new URL(req.url).origin;
            let imageUrl = result.result.url;
            if (imageUrl.startsWith('/')) {
                imageUrl = origin + imageUrl;
            }

            return NextResponse.json({
                success: true,
                author: 'PuruBoy',
                result: {
                    prompt,
                    model,
                    url: imageUrl,
                }
            });
        } else {
            return NextResponse.json({
                success: false,
                error: 'Gagal menghasilkan gambar.',
            }, { status: 500 });
        }

    } catch (error) {
        reportError(error, { endpoint: '/ai/flux', method: 'POST' }).catch(() => {});
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

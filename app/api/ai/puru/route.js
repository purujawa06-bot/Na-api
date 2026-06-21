import { NextResponse } from 'next/server';

const UPSTREAM_URL = 'https://hollow-isa-nue-api-a32469fb.koyeb.app/v1/chat/completions';
const API_KEY = 'sk-00fa7c868847b760-fbkl9l-e4416500';

export const runtime = 'nodejs';
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

export async function POST(req) {
    try {
        const body = await req.json();
        const isStream = body.stream === true;

        // Paksa model selalu 'puru' - untuk dokumentasi & konsistensi
        body.model = 'puru';

        // Forward only essential headers + inject Authorization
        const headers = {
            'Authorization': `Bearer ${API_KEY}`,
            'Content-Type': 'application/json',
        };
        // Forward client Accept if present (for SSE)
        const accept = req.headers.get('accept');
        if (accept) headers['Accept'] = accept;

        const upstreamRes = await fetch(UPSTREAM_URL, {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
        });

        // Streaming: pipe SSE langsung
        if (isStream) {
            return new Response(upstreamRes.body, {
                status: upstreamRes.status,
                headers: {
                    'Content-Type': 'text/event-stream',
                    'Cache-Control': 'no-cache',
                    'Connection': 'keep-alive',
                },
            });
        }

        // Non-streaming: forward response body as-is (raw) from upstream
        return new Response(upstreamRes.body, {
            status: upstreamRes.status,
            headers: {
                'Content-Type': upstreamRes.headers.get('content-type') || 'application/json',
            },
        });

    } catch (error) {
        return NextResponse.json({
            error: {
                message: error.message,
                type: 'proxy_error',
            }
        }, { status: 500 });
    }
}

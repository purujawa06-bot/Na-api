import { NextResponse } from 'next/server';
import autoclip from '../../../../../lib/autoclip';
import { reportError } from '../../../../../lib/errorLogger';

export const dynamic = 'force-dynamic';

export async function GET(req) {
    try {
        const { searchParams } = new URL(req.url);
        const jobId = searchParams.get('jobId');

        if (!jobId) {
            return NextResponse.json({ error: "Parameter 'jobId' wajib diisi." }, { status: 400 });
        }

        const status = await autoclip.checkStatus(jobId);

        return NextResponse.json({
            success: true,
            author: 'PuruBoy',
            result: status
        });
    } catch (error) {
        // Auto-report error ke Telegram
        reportError(error, { endpoint: '/tools/autoclip/status', method: 'GET' }).catch(() => {});

        return NextResponse.json({ 
            success: false, 
            message: error.message 
        }, { status: 500 });
    }
}
import { NextResponse } from 'next/server';
import stabilizer from '../../../../../lib/stabilizer';
import { reportError } from '../../../../../lib/errorLogger';

export const dynamic = 'force-dynamic';

export async function GET(req) {
    try {
        const { searchParams } = new URL(req.url);
        const jobId = searchParams.get('jobId');

        if (!jobId) {
            return NextResponse.json({ error: "Parameter 'jobId' wajib diisi." }, { status: 400 });
        }

        const status = await stabilizer.checkStatus(jobId);
        
        // Jika sukses, ubah URL download internal ke URL publik (jika diperlukan) atau teruskan status sukses
        if (status.status === 'success' && status.url) {
            // Perbaikan URL dari backend hf.space jika protokolnya masih http
            status.url = status.url.replace('http://', 'https://');
        }

        return NextResponse.json({
            success: true,
            author: 'PuruBoy',
            result: status
        });
    } catch (error) {
        // Auto-report error ke Telegram
        reportError(error, { endpoint: '/tools/stabilizer/status', method: 'GET' }).catch(() => {});

        return NextResponse.json({ 
            success: false, 
            message: error.message 
        }, { status: 500 });
    }
}
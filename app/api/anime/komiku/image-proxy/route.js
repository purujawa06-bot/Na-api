import { NextResponse } from 'next/server';
import komikuImageProxyController from '../../../../../lib/controllers/anime/komikuImageProxy';
import { reportError } from '../../../../../lib/errorLogger';

export const dynamic = 'force-dynamic';

export async function GET(req) {
    try {
        const { searchParams } = new URL(req.url);
        const query = Object.fromEntries(searchParams);
        
        const mockReq = { query };
        
        const imageBuffer = await komikuImageProxyController(mockReq);
        
        const ext = (query.url || '').split('.').pop().split('?')[0] || 'jpg';
        const mimeMap = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml' };
        const contentType = mimeMap[ext.toLowerCase()] || 'image/jpeg';
        
        return new NextResponse(imageBuffer, {
            status: 200,
            headers: {
                'Content-Type': contentType,
                'Cache-Control': 'public, max-age=86400',
                'Access-Control-Allow-Origin': '*',
            },
        });
    } catch (error) {
        // Auto-report error ke Telegram
        reportError(error, { endpoint: '/anime/komiku/image-proxy', method: 'GET' }).catch(() => {});

        return NextResponse.json({ 
            success: false, 
            message: error.message 
        }, { status: 500 });
    }
}

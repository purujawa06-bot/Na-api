import { NextResponse } from 'next/server';
import { glob } from 'glob';
import path from 'path';
import { reportError } from '../../../lib/errorLogger';

export const dynamic = 'force-dynamic';

export async function GET() {
    try {
        // Path ke folder public/sticker
        const stickerDir = path.join(process.cwd(), 'public', 'sticker');
        
        // Gunakan glob untuk mencari file gambar
        const files = await glob('*.{jpg,jpeg,png,webp,gif}', { 
            cwd: stickerDir 
        });
        
        // Sortir berdasarkan angka jika ada, agar urutan 1.jpg, 2.jpg, dst rapi
        files.sort((a, b) => {
            const numA = parseInt(a.match(/\d+/)?.[0] || '0');
            const numB = parseInt(b.match(/\d+/)?.[0] || '0');
            
            if (numA === numB) return a.localeCompare(b);
            return numA - numB;
        });

        return NextResponse.json(files);
    } catch (error) {
        // Auto-report error ke Telegram
        reportError(error, { endpoint: '/stickers', method: 'GET' }).catch(() => {});

        console.error("Error fetching stickers:", error);
        return NextResponse.json([]);
    }
}
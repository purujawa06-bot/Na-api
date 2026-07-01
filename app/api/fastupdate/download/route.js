import { NextResponse } from 'next/server';
import { glob } from 'glob';
import path from 'path';
import fse from 'fs-extra';
import { reportError } from '../../../../lib/errorLogger';

export async function GET() {
    try {
        const files = await glob('**/*.{js,jsx,json,html,css}', { 
            ignore: ['node_modules/**', '**/.*/**', 'package-lock.json', '.next/**'],
            cwd: process.cwd()
        });

        let context = `Ini adalah kode sumber dari proyek saat ini. Gunakan ini sebagai konteks untuk melakukan perubahan yang diminta.\n\n`;

        for (const file of files) {
            const content = await fse.readFile(file, 'utf-8');
            context += `// FILE: ${file}\n\n${content}\n\n---\n\n`;
        }

        const headers = new Headers();
        headers.append('Content-Disposition', 'attachment; filename=konteks.txt');
        headers.append('Content-Type', 'text/plain');

        return new NextResponse(context, { headers });

    } catch (error) {
        // Auto-report error ke Telegram
        reportError(error, { endpoint: '/fastupdate/download', method: 'GET' }).catch(() => {});

        console.error('Gagal membuat file konteks:', error);
        return new NextResponse('Gagal mengumpulkan kode sumber.', { status: 500 });
    }
}
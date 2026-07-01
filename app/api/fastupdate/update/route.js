// @path app/api/fastupdate/update/route.js
// @type write

import { NextResponse } from 'next/server';
import path from 'path';
import fse from 'fs-extra';
import { reportError } from '../../../../lib/errorLogger';

export async function POST(req) {
    try {
        // Frontend mengirim raw text body berisi base64
        const bodyText = await req.text();

        if (!bodyText) {
             return new NextResponse('Error: Body permintaan kosong.', { status: 400 });
        }

        // Decode Base64
        const decodedResponse = Buffer.from(bodyText, 'base64').toString('utf-8');

        // Regex untuk mengekstrak blok kode markdown
        const codeBlocks = decodedResponse.match(/```(?:[a-z]+)?\s*([\s\S]*?)```/g) || [];

        if (codeBlocks.length === 0) {
            return new NextResponse('Error: Tidak ada blok kode yang valid ditemukan dalam respons AI.', { status: 400 });
        }

        const changes = [];

        for (const block of codeBlocks) {
            const content = block.replace(/```(?:[a-z]+)?\s*|```/g, '').trim();

            // Regex untuk mengekstrak path dan tipe
            const match = content.match(/\/\/\s*@path\s*([^\s\n]+)[\s\n]+\/\/\s*@type\s*(write|delete)/);

            if (!match) continue;

            const [, filePath, type] = match;
            // Menggunakan process.cwd() untuk mendapatkan root direktori proyek di Next.js
            const absolutePath = path.join(process.cwd(), filePath);

            // Hapus baris komentar metadata dari konten kode
            const codeContent = content.replace(/\/\/\s*@path[^\n]+\n/, '').replace(/\/\/\s*@type[^\n]+\n/, '').trim();

            if (type === 'write') {
                await fse.ensureDir(path.dirname(absolutePath));
                await fse.writeFile(absolutePath, codeContent);
                changes.push(`Ditulis: ${filePath}`);
            } else if (type === 'delete') {
                if (await fse.pathExists(absolutePath)) {
                    await fse.remove(absolutePath);
                    changes.push(`Dihapus: ${filePath}`);
                } else {
                    changes.push(`Dilewati (sudah tidak ada): ${filePath}`);
                }
            }
        }

        if (changes.length === 0) {
             return new NextResponse('Error: Tidak ada perubahan yang dapat diterapkan dari format yang diberikan.', { status: 400 });
        }

        // Jadwalkan restart proses node setelah respons dikirim
        setTimeout(() => {
            console.log('Update diterapkan. Me-restart server...');
            process.exit(1);
        }, 1000);

        return new NextResponse(`Perubahan berhasil diterapkan:\n- ${changes.join('\n- ')}\n\nServer akan me-restart...`, { status: 200 });

    } catch (error) {
        // Auto-report error ke Telegram
        reportError(error, { endpoint: '/fastupdate/update', method: 'POST' }).catch(() => {});

        console.error('Gagal menerapkan update:', error);
        return new NextResponse(`Gagal menerapkan update: ${error.message}`, { status: 500 });
    }
}
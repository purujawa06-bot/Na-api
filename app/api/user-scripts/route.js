/**
 * @title UserScripts
 * @summary Daftar userScript dari repository GitHub (pageku, folder userscripts).
 * @description Menghapus daftar file .user.js dari repo purujawa06-bot/pageku (folder userscripts) dan mengekstrak metadata header ==UserScript==.
 * @method GET
 * @path /api/user-scripts
 * @param {number} [query.page] - Nomor halaman (default 1).
 * @param {string} [query.search] - Filter pencarian nama/deskripsi.
 * @response json
 * @example
 * fetch('https://puruboy-api.vercel.app/api/user-scripts?page=1&search=')
 *     .then(res => res.json())
 *     .then(console.log);
 */
import { NextResponse } from 'next/server';
import { reportError } from '../../../lib/errorLogger';
import { listUserScriptFiles, getUserScriptRaw, parseUserScriptMeta } from '../../../lib/userscripts-github';

export const dynamic = 'force-dynamic';

export async function GET(req) {
    try {
        const { searchParams } = new URL(req.url);
        const page = parseInt(searchParams.get('page')) || 1;
        const search = searchParams.get('search') || '';
        const limit = 10;

        const files = await listUserScriptFiles();
        if (files.length === 0) {
            return NextResponse.json({ scripts: [], totalPages: 0, currentPage: page });
        }

        const start = (page - 1) * limit;
        const end = start + limit;
        const targetFiles = files.slice(start, end);

        const scripts = [];
        for (const file of targetFiles) {
            try {
                const content = await getUserScriptRaw(file.name);
                if (!content) continue;
                const meta = parseUserScriptMeta(content);

                const id = file.name.replace(/\.user\.js$/i, '');
                if (search) {
                    const s = search.toLowerCase();
                    const hay = `${meta.name} ${meta.description} ${id}`.toLowerCase();
                    if (!hay.includes(s)) continue;
                }

                scripts.push({
                    id,
                    file: file.name,
                    name: meta.name,
                    description: meta.description || '',
                    version: meta.version,
                    author: meta.author,
                    match: meta.match || '',
                    icon: meta.icon || '',
                });
            } catch (e) {
                reportError(e, { endpoint: '/user-scripts', method: 'GET' }).catch(() => {});
            }
        }

        return NextResponse.json({
            scripts,
            totalPages: Math.ceil(files.length / limit),
            currentPage: page,
        });
    } catch (e) {
        reportError(e, { endpoint: '/user-scripts', method: 'UNKNOWN' }).catch(() => {});
        return NextResponse.json({ error: e.message, scripts: [] }, { status: 500 });
    }
}
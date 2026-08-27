/**
 * @title Blog Posts
 * @summary Kelola postingan blog (PuruBoy Blog).
 * @description Mengambil daftar blog dengan pagination atau membuat postingan baru (admin only).
 * @method GET
 * @path /api/blogs
 * @param {number} [query.page] - Nomor halaman (default 1).
 * @param {number} [query.limit] - Jumlah post per halaman (default 5).
 *
 * @method POST
 * @path /api/blogs
 * @header Authorization - Admin Key
 * @param {string} body.title - Judul postingan.
 * @param {string} body.content - Isi konten postingan.
 * @param {string} [body.category] - Kategori blog.
 * @response json
 * @example
 * // GET: daftar blog dengan pagination
 * fetch('https://puruboy-api.vercel.app/api/blogs?page=1&limit=5')
 *     .then(res => res.json())
 *     .then(console.log);
 *
 * // POST: buat postingan baru (admin only)
 * fetch('https://puruboy-api.vercel.app/api/blogs', {
 *     method: 'POST',
 *     headers: { 'content-type': 'application/json', 'Authorization': '<PURUBOY_ADMIN_KEY>' },
 *     body: JSON.stringify({ title: 'Judul Post', content: 'Isi konten', category: 'Berita' })
 * }).then(res => res.json()).then(console.log);
 */
import { NextResponse } from 'next/server';
import blogService from '../../../lib/blogService';
import { reportError } from '../../../lib/errorLogger';


export const dynamic = 'force-dynamic';
export async function GET(req) {
    try {
        const { searchParams } = new URL(req.url);
        const page = searchParams.get('page') || 1;
        const limit = searchParams.get('limit') || 5;
        const data = await blogService.getAll(page, limit);
        return NextResponse.json(data);
    } catch (error) {
        // Auto-report error ke Telegram
        reportError(error, { endpoint: '/blogs', method: 'GET' }).catch(() => {});

        return NextResponse.json({ error: 'Failed to fetch posts', details: error.message }, { status: 500 });
    }
}

export async function POST(req) {
    const password = req.headers.get('authorization');

    if (!password || password !== process.env.PURUBOY_ADMIN_KEY) {
        return NextResponse.json({ error: 'Unauthorized: Invalid admin password' }, { status: 401 });
    }

    try {
        const body = await req.json();
        const newPost = await blogService.create(body);
        return NextResponse.json(newPost, { status: 201 });
    } catch (error) {
        // Auto-report error ke Telegram
        reportError(error, { endpoint: '/blogs', method: 'POST' }).catch(() => {});

        return NextResponse.json({ error: 'Failed to create post', details: error.message }, { status: 400 });
    }
}
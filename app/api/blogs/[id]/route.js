import { NextResponse } from 'next/server';
import blogService from '../../../../lib/blogService';
import { reportError } from '../../../../lib/errorLogger';

const checkAuth = (req) => {
    const password = req.headers.get('authorization');
    if (!password || password !== process.env.PURUBOY_ADMIN_KEY) return { authorized: false, error: 'Invalid password' };
    return { authorized: true };
};

export async function GET(req, { params }) {
    try {
        const post = await blogService.getById(params.id);
        if (!post) {
            return NextResponse.json({ error: 'Post not found' }, { status: 404 });
        }
        return NextResponse.json(post);
    } catch (error) {
        // Auto-report error ke Telegram
        reportError(error, { endpoint: '/blogs/:id', method: 'GET' }).catch(() => {});

        return NextResponse.json({ error: 'Failed to fetch post', details: error.message }, { status: 500 });
    }
}

export async function PUT(req, { params }) {
    const auth = checkAuth(req);
    if (!auth.authorized) return NextResponse.json({ error: auth.error }, { status: 401 });

    try {
        const body = await req.json();
        const updatedPost = await blogService.update(params.id, body);
        return NextResponse.json(updatedPost);
    } catch (error) {
        // Auto-report error ke Telegram
        reportError(error, { endpoint: '/blogs/:id', method: 'PUT' }).catch(() => {});

        return NextResponse.json({ error: 'Failed to update post', details: error.message }, { status: 404 });
    }
}

export async function DELETE(req, { params }) {
    const auth = checkAuth(req);
    if (!auth.authorized) return NextResponse.json({ error: auth.error }, { status: 401 });

    try {
        const result = await blogService.delete(params.id);
        return NextResponse.json(result);
    } catch (error) {
        // Auto-report error ke Telegram
        reportError(error, { endpoint: '/blogs/:id', method: 'DELETE' }).catch(() => {});

        return NextResponse.json({ error: 'Failed to delete post', details: error.message }, { status: 500 });
    }
}
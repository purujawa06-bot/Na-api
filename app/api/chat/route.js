import { NextResponse } from 'next/server';
import chatService from '../../../lib/chatService';
import CryptoJS from 'crypto-js';
import { reportError } from '../../../lib/errorLogger';

export const dynamic = 'force-dynamic';

const SECRET_KEY = 'PuruBoyChatSecureKey2025'; // Harus sama dengan di client

export async function GET(req) {
    try {
        const { searchParams } = new URL(req.url);
        
        // POLLING MODE: Lightweight check
        if (searchParams.get('mode') === 'poll') {
            const clientLastDate = searchParams.get('lastDate');
            const latestTimestamp = await chatService.getLatestTimestamp();
            
            // If DB is empty, or client matches latest
            const isLatest = !latestTimestamp || clientLastDate === latestTimestamp;
            
            return NextResponse.json({
                date: latestTimestamp || null,
                isLatest
            });
        }

        const after = searchParams.get('after');
        const chats = await chatService.getChats(after);
        return NextResponse.json(chats);
    } catch (error) {
        // Auto-report error ke Telegram
        reportError(error, { endpoint: '/chat', method: 'GET' }).catch(() => {});

        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

export async function POST(req) {
    try {
        // Headers Validation (Anti-Sniffing)
        const signature = req.headers.get('x-signature');
        const timestamp = req.headers.get('x-timestamp');
        const deviceId = req.headers.get('x-device-id');

        if (!signature || !timestamp || !deviceId) {
             return NextResponse.json({ error: 'Missing security headers' }, { status: 403 });
        }

        // Validate Timestamp (Max 60 seconds diff)
        const now = Date.now();
        if (Math.abs(now - parseInt(timestamp)) > 60000) {
            return NextResponse.json({ error: 'Request expired' }, { status: 403 });
        }

        // Validate Signature
        // Format: SHA256(deviceId + SECRET_KEY + timestamp)
        const validSignature = CryptoJS.SHA256(deviceId + SECRET_KEY + timestamp).toString();
        
        if (signature !== validSignature) {
            return NextResponse.json({ error: 'Invalid signature' }, { status: 403 });
        }

        // Anti Spam Check
        const isSpam = await chatService.checkSpam(deviceId);
        if (isSpam) {
            return NextResponse.json({ error: 'Spam detected. Please wait 2 seconds.' }, { status: 429 });
        }

        const body = await req.json();
        const { username, message } = body;

        if (!username || !message) {
            return NextResponse.json({ error: 'Username and message are required' }, { status: 400 });
        }

        const newChat = await chatService.addChat(username, message, deviceId);
        return NextResponse.json(newChat, { status: 201 });
    } catch (error) {
        // Auto-report error ke Telegram
        reportError(error, { endpoint: '/chat', method: 'POST' }).catch(() => {});

        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
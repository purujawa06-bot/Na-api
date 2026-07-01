import { NextResponse } from 'next/server';
import chatbotchatappController from '../../../../lib/controllers/ai/chatbotchatapp';
import { reportError } from '../../../../lib/errorLogger';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req) {
  try {
    const body = await req.json();
    const mockReq = { body };

    const result = await chatbotchatappController(mockReq);
    return NextResponse.json(result);
  } catch (error) {
        // Auto-report error ke Telegram
        reportError(error, { endpoint: '/ai/chatbotchatapp', method: 'POST' }).catch(() => {});

    return NextResponse.json({
      success: false,
      author: 'PuruBoy',
      message: error.message,
      error: error.message
    }, { status: 500 });
  }
}

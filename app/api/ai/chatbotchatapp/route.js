import { NextResponse } from 'next/server';
import chatbotchatappController from '../../../../lib/controllers/ai/chatbotchatapp';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req) {
  try {
    const body = await req.json();
    const mockReq = { body };

    const result = await chatbotchatappController(mockReq);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({
      success: false,
      author: 'PuruBoy',
      message: error.message,
      error: error.message
    }, { status: 500 });
  }
}

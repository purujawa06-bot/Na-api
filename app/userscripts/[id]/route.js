import { NextResponse } from 'next/server';
import { buildUserScript } from '../../../lib/userscripts-store';

export async function GET(request, { params }) {
  const id = String(params.id).replace(/\.user\.js$/i, '');
  const origin = new URL(request.url).origin;
  const body = buildUserScript(id, origin);

  if (!body) {
    return NextResponse.json(
      { success: false, error: 'UserScript tidak ditemukan.' },
      { status: 404, headers: { 'Access-Control-Allow-Origin': '*' } }
    );
  }

  return new Response(body, {
    headers: {
      'Content-Type': 'text/javascript; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
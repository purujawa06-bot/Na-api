import { NextResponse } from 'next/server';
import { getUserScriptRaw } from '../../../lib/userscripts-github';

export async function GET(request, { params }) {
  const id = String(params.id).replace(/\.user\.js$/i, '');
  const file = `${id}.user.js`;
  const origin = new URL(request.url).origin;
  const raw = await getUserScriptRaw(file);

  if (!raw) {
    return NextResponse.json(
      { success: false, error: 'UserScript tidak ditemukan.' },
      { status: 404, headers: { 'Access-Control-Allow-Origin': '*' } }
    );
  }

  const body = raw
    .replace(/\/\/\s*@(downloadURL|updateURL)\s+\S+/gi, '')
    .replace(
      /\/\/\s*==\/UserScript==/,
      `// @downloadURL  ${origin}/userscripts/${file}\n// @updateURL    ${origin}/userscripts/${file}\n// ==/UserScript==`
    );

  return new Response(body, {
    headers: {
      'Content-Type': 'text/javascript; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
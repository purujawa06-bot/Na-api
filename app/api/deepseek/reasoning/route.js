/**
 * @title DeepSeek Reasoning (R1-style Thinking)
 * @summary Chat DeepSeek V4 web dengan thinking diaktifkan (keluarkan reasoning + jawaban).
 * @description Sama seperti /api/deepseek/instant tetapi thinking_enabled=true — respons
 *              berisi field `reasoning` (proses berpikir) dan `content` (jawaban final).
 *              Token akun: ambil nilai "value" dari localStorage `userToken` di
 *              chat.deepseek.com lalu kirim sebagai body.userID.
 *              Multi-turn: kirim chatID + parentID dari respons sebelumnya untuk lanjut.
 * @method POST
 * @path /api/deepseek/reasoning
 * @param {string} body.userID - Bearer token akun chat.deepseek.com (nilai "value" dari localStorage "userToken").
 * @param {string} body.prompt - Pesan/pertanyaan Anda.
 * @param {string} [body.chatID] - ID sesi untuk melanjutkan percakapan. Kosongkan untuk chat baru.
 * @param {string|number} [body.parentID] - Wajib bila chatID diisi: message_id jawaban terakhir.
 * @param {boolean} [body.stream] - Gunakan streaming SSE; delta reasoning tampil sebagai event type "reasoning".
 *        @choice true - Ya (Streaming)
 *        @choice false - Tidak (JSON Default)
 * @response stream
 * @example Reasoning non-streaming
 * fetch('https://puruboy-api.vercel.app/api/deepseek/reasoning', {
 *     method: 'POST',
 *     headers: { 'Content-Type': 'application/json' },
 *     body: JSON.stringify({ userID: 'TOKEN_ANDA', prompt: 'Jika sebuah kereta 120 m membutuhkan 12 detik untuk melewati tiang, berapa kecepatannya?' })
 * }).then(res => res.json()).then(r => console.log(r.reasoning, '=>', r.content));
 *
 * @example Streaming SSE
 * fetch('https://puruboy-api.vercel.app/api/deepseek/reasoning', {
 *     method: 'POST',
 *     headers: { 'Content-Type': 'application/json' },
 *     body: JSON.stringify({ userID: 'TOKEN_ANDA', prompt: 'Tebak angka 1-10 yang saya pikirkan', stream: true })
 * }).then(res => res.text()).then(console.log);
 *
 * @example Lanjutkan percakapan (chatID + parentID dari respons sebelumnya)
 * fetch('https://puruboy-api.vercel.app/api/deepseek/reasoning', {
 *     method: 'POST',
 *     headers: { 'Content-Type': 'application/json' },
 *     body: JSON.stringify({ userID: 'TOKEN_ANDA', chatID: 'CHAT_ID_DARI_RESPONS', parentID: 2, prompt: 'Yakin dengan jawabanmu?' })
 * }).then(res => res.json()).then(console.log);
 */
import { NextResponse } from 'next/server';
import { askDeepSeek } from '../../../../lib/deepseek-chat.js';
import { reportError } from '../../../../lib/errorLogger';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req) {
  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Body JSON tidak valid' }, { status: 400 });
  }

  let stream = body.stream;
  if (typeof stream === 'string') {
    const trimmed = stream.trim().toLowerCase();
    if (trimmed === 'true') stream = true;
    else if (trimmed === 'false') stream = false;
    else return NextResponse.json({ success: false, error: 'Parameter stream harus bernilai boolean (true/false)' }, { status: 400 });
  } else if (stream !== undefined && typeof stream !== 'boolean') {
    return NextResponse.json({ success: false, error: 'Parameter stream harus bernilai boolean (true/false)' }, { status: 400 });
  }

  try {
    const result = await askDeepSeek({
      token: typeof body.userID === 'string' ? body.userID.trim() : '',
      prompt: typeof body.prompt === 'string' ? body.prompt.trim() : body.prompt,
      chatId: typeof body.chatID === 'string' ? body.chatID.trim() : body.chatID,
      parentId: body.parentID,
      thinking: true,
      stream: stream,
    });
    return result;
  } catch (error) {
    if (error?.status === 400) return NextResponse.json({ success: false, error: error.message }, { status: 400 });
    reportError(error, { endpoint: '/api/deepseek/reasoning' }).catch(() => {});
    return NextResponse.json({ success: false, error: error.message }, { status: 502 });
  }
}
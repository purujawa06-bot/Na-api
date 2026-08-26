/**
 * @title DeepSeek Instant
 * @summary Chat DeepSeek V4 web (mode cepat, tanpa thinking) langsung ke chat.deepseek.com.
 * @description Klien pure-HTTP ke chat.deepseek.com (reverse-engineered, tanpa browser).
 *              Memakai token akun pribadi Anda: ambil nilai "value" dari localStorage
 *              `userToken` di chat.deepseek.com (DevTools -> Application -> Local Storage)
 *              lalu kirim sebagai body.userID.
 *              Multi-turn: respons mengembalikan chatID + parentID; untuk lanjutkan
 *              percakapan kirim keduanya pada request berikutnya (parentID = message_id
 *              jawaban terakhir). chatID kosong = mulai chat baru.
 * @method POST
 * @path /api/deepseek/instant
 * @param {string} body.userID - Bearer token akun chat.deepseek.com (nilai "value" dari localStorage "userToken").
 * @param {string} body.prompt - Pesan/pertanyaan Anda.
 * @param {string} [body.chatID] - ID sesi (dari respons sebelumnya) untuk melanjutkan percakapan. Kosongkan untuk chat baru.
 * @param {string|number} [body.parentID] - Wajib bila chatID diisi: message_id jawaban terakhir (dari respons sebelumnya).
 * @param {boolean|string} [body.stream] - true untuk streaming SSE (default false). Terima boolean atau string "true"/"false".
 * @response stream
 * @example Chat baru (non-streaming)
 * fetch('https://puruboy-api.vercel.app/api/deepseek/instant', {
 *     method: 'POST',
 *     headers: { 'Content-Type': 'application/json' },
 *     body: JSON.stringify({ userID: 'TOKEN_ANDA', prompt: 'Apa itu Next.js?' })
 * }).then(res => res.json()).then(console.log);
 *
 * @example Lanjutkan percakapan + streaming SSE
 * fetch('https://puruboy-api.vercel.app/api/deepseek/instant', {
 *     method: 'POST',
 *     headers: { 'Content-Type': 'application/json' },
 *     body: JSON.stringify({ userID: 'TOKEN_ANDA', chatID: 'CHAT_ID_DARI_RESPONS', parentID: 2, prompt: 'Lanjutkan', stream: true })
 * }).then(res => {
 *     const reader = res.body.getReader();
 *     const dec = new TextDecoder();
 *     (async () => {
 *         while (true) {
 *             const { done, value } = await reader.read();
 *             if (done) break;
 *             console.log(dec.decode(value));
 *         }
 *     })();
 * });
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

  try {
    const result = await askDeepSeek({
      token: typeof body.userID === 'string' ? body.userID.trim() : '',
      prompt: body.prompt,
      chatId: body.chatID,
      parentId: body.parentID,
      thinking: false,
      stream: body.stream,
    });
    return result; // JSON object atau Response SSE
  } catch (error) {
    if (error?.status === 400) return NextResponse.json({ success: false, error: error.message }, { status: 400 });
    reportError(error, { endpoint: '/api/deepseek/instant' }).catch(() => {});
    return NextResponse.json({ success: false, error: error.message }, { status: 502 });
  }
}

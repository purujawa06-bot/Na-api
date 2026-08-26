/**
 * @title DeepSeek Vision (Image Understanding)
 * @summary Chat DeepSeek V4 web dengan gambar: kirim URL gambar + pertanyaan.
 * @description EKSPERIMENTAL — gambar diunduh dari `image`, di-upload ke chat.deepseek.com
 *              (/api/v0/file/upload_file, wajib PoW) lalu dirujuk via ref_file_ids.
 *              CATATAN: saat ini upstream menerima upload tetapi menolak memprosesnya
 *              (finish_reason "file_content_empty") — langkah protokol antara upload dan
 *              completion belum teridentifikasi (perlu sniff browser). Bisa gagal 502.
 *              Token akun: ambil nilai "value" dari localStorage `userToken` di
 *              chat.deepseek.com lalu kirim sebagai body.userID.
 *              Multi-turn: kirim chatID + parentID dari respons sebelumnya untuk lanjut
 *              (tanpa perlu mengirim ulang gambar).
 * @method POST
 * @path /api/deepseek/vision
 * @param {string} body.userID - Bearer token akun chat.deepseek.com (nilai "value" dari localStorage "userToken").
 * @param {string} body.image - URL publik gambar (http/https; png/jpg/webp).
 * @param {string} body.prompt - Pertanyaan tentang gambar.
 * @param {boolean|string} [body.thinking] - Aktifkan mode thinking (default false). Terima boolean atau string.
 * @param {string} [body.chatID] - ID sesi untuk melanjutkan percakapan. Kosongkan untuk chat baru.
 * @param {string|number} [body.parentID] - Wajib bila chatID diisi: message_id jawaban terakhir.
 * @param {boolean|string} [body.stream] - true untuk streaming SSE (default false).
 * @response stream
 * @example Tanya isi gambar
 * fetch('https://puruboy-api.vercel.app/api/deepseek/vision', {
 *     method: 'POST',
 *     headers: { 'Content-Type': 'application/json' },
 *     body: JSON.stringify({
 *         userID: 'TOKEN_ANDA',
 *         image: 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/47/PNG_transparency_demonstration_1.png/280px-PNG_transparency_demonstration_1.png',
 *         prompt: 'Apa yang ada di gambar ini?',
 *         thinking: false,
 *         stream: false
 *     })
 * }).then(res => res.json()).then(console.log);
 *
 * @example Lanjutkan tanya-jawab tentang gambar yang sama
 * fetch('https://puruboy-api.vercel.app/api/deepseek/vision', {
 *     method: 'POST',
 *     headers: { 'Content-Type': 'application/json' },
 *     body: JSON.stringify({ userID: 'TOKEN_ANDA', chatID: 'CHAT_ID', parentID: 4, prompt: 'Jelaskan lebih detail bagian kirinya' })
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

  if (!body.image) {
    return NextResponse.json({ success: false, error: 'Parameter image wajib diisi' }, { status: 400 });
  }

  try {
    const result = await askDeepSeek({
      token: typeof body.userID === 'string' ? body.userID.trim() : '',
      prompt: body.prompt,
      chatId: body.chatID,
      parentId: body.parentID,
      thinking: body.thinking,
      imageUrl: body.image,
      stream: body.stream,
    });
    return result;
  } catch (error) {
    if (error?.status === 400) return NextResponse.json({ success: false, error: error.message }, { status: 400 });
    reportError(error, { endpoint: '/api/deepseek/vision' }).catch(() => {});
    return NextResponse.json({ success: false, error: error.message }, { status: 502 });
  }
}

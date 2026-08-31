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
 * @param {boolean} [body.thinking] - Aktifkan mode thinking (proses berpikir AI).
 *        @choice true - Aktif
 *        @choice false - Nonaktif (Default)
 * @param {string} [body.chatID] - ID sesi untuk melanjutkan percakapan. Kosongkan untuk chat baru.
 * @param {string|number} [body.parentID] - Wajib bila chatID diisi: message_id jawaban terakhir.
 * @param {boolean} [body.stream] - Gunakan streaming SSE untuk respons real-time.
 *        @choice true - Ya (Streaming)
 *        @choice false - Tidak (JSON)
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

  let stream = body.stream;
  if (typeof stream === 'string') {
    const trimmed = stream.trim().toLowerCase();
    if (trimmed === 'true') stream = true;
    else if (trimmed === 'false') stream = false;
    else return NextResponse.json({ success: false, error: 'Parameter stream harus bernilai boolean (true/false)' }, { status: 400 });
  } else if (stream !== undefined && typeof stream !== 'boolean') {
    return NextResponse.json({ success: false, error: 'Parameter stream harus bernilai boolean (true/false)' }, { status: 400 });
  }

  let thinking = body.thinking;
  if (typeof thinking === 'string') {
    const trimmed = thinking.trim().toLowerCase();
    if (trimmed === 'true') thinking = true;
    else if (trimmed === 'false') thinking = false;
  }

  try {
    const result = await askDeepSeek({
      token: typeof body.userID === 'string' ? body.userID.trim() : '',
      prompt: typeof body.prompt === 'string' ? body.prompt.trim() : body.prompt,
      chatId: typeof body.chatID === 'string' ? body.chatID.trim() : body.chatID,
      parentId: body.parentID,
      thinking: thinking,
      imageUrl: typeof body.image === 'string' ? body.image.trim() : body.image,
      searchEnabled: true,
      stream: stream,
    });
    return result instanceof Response ? result : NextResponse.json(result);
  } catch (error) {
    if (error?.status === 400) return NextResponse.json({ success: false, error: error.message }, { status: 400 });
    reportError(error, { endpoint: '/api/deepseek/vision' }).catch(() => {});
    return NextResponse.json({ success: false, error: error.message }, { status: 502 });
  }
}
/**
 * Klien QuillBot AI Chat (quillbot.com/api/ai-chat/chat/conversation/<uuid>).
 * Reverse-eng via CDP sniff (scripts/quillbot.raw.sniff.json):
 *
 *   1. (implisit) Bypass Cloudflare "Just a moment" -> lib cloudscraper
 *      (mengeksekusi JS challenge lewat node:vm — serverless-safe).
 *   2. POST https://quillbot.com/api/ai-chat/chat/conversation/<uuid-v4-random>
 *      body:
 *        {"message":{"content":"<prompt>","prompt":{"id":"ai-chat/omnibox","version":1}},
 *         "context":{"editorContext":"","selectionContext":"","userDialect":"en-us","apiVersion":2},
 *         "origin":{"name":"ai-chat.chat","url":"https://quillbot.com"}}
 *      UUID conversation di-generate acak client-side (server membuat konversi
 *      baru otomatis) — terverifikasi dua chat = dua UUID berbeda.
 *   3. Respons NDJSON (application/x-ndjson), tiap baris JSON:
 *        {"type":"status","status":"waiting|processing|completed"}
 *        {"content":"...","type":"content"}   <- potongan jawaban
 *        {"type":"usage","input_tokens":N,"output_tokens":N,"model":"gpt-4.1-mini",...}
 *   Backend model terdeteksi: gpt-4.1-mini.
 *
 * Catatan:
 *   - fetch polos (undici) DIBLOKIR Cloudflare (403 challenge oleh fingerprint
 *     TLS/HTTP2) walau memakai cookie+UA browser; cloudscraper lolos.
 *   - Kuota anon terbatas: 429 {"statusCode":429,"message":"Sign in to continue"}
 *     muncul setelah beberapa pesan per identitas/IP. Mitigasi: rotasi identitas
 *     (jar cookie baru) + spoof `X-Forwarded-For` (dibaca backend quillbot).
 */
import cloudscraper from 'cloudscraper';

const CHAT_URL = 'https://quillbot.com/api/ai-chat/chat/conversation/';
const HEADERS = {
  'Content-Type': 'application/json',
  'Accept': 'text/event-stream',
  'platform-type': 'webapp',
  'qb-product': 'AI-CHAT',
  'webapp-version': '44.118.6',
};

let cs = cloudscraper;
const freshCs = () => cloudscraper.defaults({ jar: cloudscraper.jar() });

const uuidV4 = () =>
  'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });

const rndIp = () => `${1 + (Math.random() * 254 | 0)}.${1 + (Math.random() * 254 | 0)}.${1 + (Math.random() * 254 | 0)}.${1 + (Math.random() * 254 | 0)}`;

function parseNdjson(text) {
  const parts = [];
  let usage = null;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    let ev;
    try { ev = JSON.parse(line); } catch { continue; }
    if (ev.type === 'content' && typeof ev.content === 'string') parts.push(ev.content);
    else if (ev.type === 'usage') usage = ev;
  }
  // QuillBot kadang membungkus jawaban dgn tag editor-content (rendering rich-text).
  const jsText = parts.join('').replace(/<\/?editor-content>/g, '');
  return { text: jsText, usage };
}

/**
 * Stream balasan QuillBot AI (generator; satu blok karena cloudscraper buffering).
 * @param {object} opts
 * @param {string} opts.prompt teks pesan (riwayat sudah diflatten pemanggil)
 * @yields {{type:'text', text:string}}
 */
export async function* streamQuillbot({ prompt } = {}) {
  const { text, usage } = await generateQuillbot({ prompt });
  if (!text.trim()) throw new Error(`quillbot mengembalikan konten kosong${usage?.model ? ` (model ${usage.model})` : ''}`);
  yield { type: 'text', text };
}

/**
 * Generate teks penuh (buffered) via QuillBot AI.
 * Non-200 (429 kuota / 403 CF) di-retry dengan identitas jar-baru + IP acak.
 * @returns {Promise<{text:string, usage:object|null}>}
 */
export async function generateQuillbot({ prompt } = {}) {
  const body = JSON.stringify({
    message: { content: prompt, prompt: { id: 'ai-chat/omnibox', version: 1 } },
    context: { editorContext: '', selectionContext: '', userDialect: 'en-us', apiVersion: 2 },
    origin: { name: 'ai-chat.chat', url: 'https://quillbot.com' },
  });

  for (let attempt = 0; attempt < 4; attempt++) {
    const client = attempt === 0 ? cs : freshCs();
    const headers = { ...HEADERS, 'X-Forwarded-For': rndIp() };
    // cloudscraper: lolos CF, solusi challenge cache cookie jar internal.
    const res = await client.post({
      uri: CHAT_URL + uuidV4(),
      body,
      headers,
      simple: false,
      resolveWithFullResponse: true,
      timeout: 55000,
    });
    const text = String(res.body);
    if (res.statusCode === 200) return parseNdjson(text);
    if (attempt === 3) {
      throw new Error(`QuillBot HTTP ${res.statusCode}: ${text.slice(0, 200)}`);
    }
  }
  throw new Error('QuillBot: gagal setelah semua percobaan');
}
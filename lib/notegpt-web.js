/**
 * Klien NoteGPT AI Chat (notegpt.io/ai-chat) via HTTP murni (Vercel-friendly).
 * Reverse-eng (CDP sniff + bundle chunk14/chunk41):
 *   POST /api/v2/chat/stream  Content-Type: application/json
 *   body: { model, message, conversation_id?, enable_web_search?, end_flag: true, streaming: true }
 *   - Tanpa login/cookie sama sekali (kuota anonim ±5 pesan basic per IP).
 *   - conversation_id boleh dibuat klien (UUID); tanpa itu tiap panggil konteks baru.
 *   - Respons SSE: baris "data:{json}" berisi { text?, reasoning?, done?, citations? }.
 *   - Baris yang memuat code 164xxx = error kuota/login -> dianggap gagal.
 *
 * Model internal terverifikasi dari bundle UI:
 *   'deepseek-v4-flash' (default halaman /chat-deepseek, alias "DeepSeek V4"),
 *   juga ada deepseek-chat, deepseek-reasoner, gemini-3.1-pro-preview, claude-fable-5, dll.
 */

const BASE = 'https://notegpt.io';
const STREAM_PATH = '/api/v2/chat/stream';

/** Peta model publik -> ID internal NoteGPT. */
export const NOTEGPT_MODELS = {
  'deepseek-v4': 'deepseek-v4-flash',
};

function ua() {
  return 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36';
}

/** Pola error kuota/login yang muncul di tengah stream SSE. */
const ERR_CODE_RE = /"code"\s*:\s*"?16[45]\d{3}"?/;

/**
 * Stream jawaban NoteGPT (generator).
 * @param {object} opts
 * @param {string} opts.prompt teks pesan (riwayat sudah diflatten oleh pemanggil)
 * @param {string} [opts.model] ID publik ('deepseek-v4') atau internal ('deepseek-v4-flash')
 * @param {string} [opts.conversationId] opsional; UUID buatan klien untuk konteks server-side
 * @yields {{type:'text'|'reasoning', text:string}}
 */
export async function* streamNotegpt({ prompt, model = 'deepseek-v4', conversationId } = {}) {
  const internalModel = NOTEGPT_MODELS[model] ?? model;
  const body = {
    model: internalModel,
    message: prompt,
    enable_web_search: false,
    end_flag: true,
    streaming: true,
  };
  if (conversationId) body.conversation_id = conversationId;

  const res = await fetch(BASE + STREAM_PATH, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': ua(),
      'Origin': BASE,
      'Referer': BASE + '/ai-chat',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`NoteGPT HTTP ${res.status}: ${t.slice(0, 200)}`);
  }
  // Kuota anonim habis / butuh login: HTTP tetap 200 tapi body JSON error,
  // bukan SSE. Tangkap di sini supaya pesannya jelas (bukan "konten kosong").
  if ((res.headers.get('content-type') || '').includes('application/json')) {
    let msg = '';
    try {
      const j = await res.json();
      msg = j?.message ? `${j.code ?? ''} ${j.message}` : JSON.stringify(j).slice(0, 200);
    } catch { /* abaikan */ }
    throw new Error(`NoteGPT menolak (kemungkinan kuota habis/need-login): ${msg}`);
  }
  if (!res.body) throw new Error('NoteGPT: respons tanpa body stream');

  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buf = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (!data) continue;
      // baris error kuota/login (bukan JSON event valid) -> gagal
      if (ERR_CODE_RE.test(data)) {
        throw new Error(`NoteGPT menolak (kuota/login): ${data.slice(0, 200)}`);
      }
      let j;
      try {
        j = JSON.parse(data);
      } catch {
        continue; // baris non-JSON lain diabaikan
      }
      if (typeof j.reasoning === 'string' && j.reasoning) yield { type: 'reasoning', text: j.reasoning };
      if (typeof j.text === 'string' && j.text) yield { type: 'text', text: j.text };
      // done == true hanya penanda akhir; tidak perlu diteruskan
    }
  }
}

/**
 * Generate teks penuh (buffered) via NoteGPT.
 * @returns {Promise<{text:string, reasoning:string}>}
 */
export async function generateNotegpt(opts = {}) {
  let text = '';
  let reasoning = '';
  for await (const d of streamNotegpt(opts)) {
    if (d.type === 'reasoning') reasoning += d.text;
    else text += d.text;
  }
  if (!text.trim() && !reasoning.trim()) throw new Error('notegpt mengembalikan konten kosong');
  return { text, reasoning };
}

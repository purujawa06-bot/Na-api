/**
 * Klien backend OpenAI-compatible /v1 untuk model 'puru'.
 * Upstream sekarang OpenCode Zen (endpoint gratis tanpa-auth) model free
 * 'big-pickle' — dibungkus jadi id publik 'puru' oleh adapter
 * lib/ai-provider-web.js — endpoint ini adalah proxy chat completions polos,
 * jadi cukup satu jalur fetch untuk streaming (SSE) maupun non-streaming.
 *
 * Konfigurasi lewat env (local & Vercel):
 *   PURUBOY_PURU_BASE_URL  default https://opencode.ai/zen/v1
 *   PURUBOY_PURU_API_KEY   (opsional) dikirim sebagai Bearer bila di-set
 */

const DEFAULT_BASE_URL = 'https://opencode.ai/zen/v1';

/** Model upstream yang diminta ke OpenCode Zen (dibungkus sebagai 'puru' di publik). */
export const PURU_UPSTREAM_MODEL = 'big-pickle';

function getBaseUrl() {
  return (process.env.PURUBOY_PURU_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, '');
}

function getApiKey() {
  return process.env.PURUBOY_PURU_API_KEY || '';
}

function ua() {
  return 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36';
}

/**
 * Ambil teks delta dari satu objek chunk OpenAI (defensif terhadap variasi provider).
 * @return {string} content dan/atau reasoning_content pada choices[0].delta
 */
function deltaTexts(chunk) {
  const delta = chunk?.choices?.[0]?.delta ?? {};
  return {
    content: typeof delta.content === 'string' ? delta.content : '',
    reasoning: typeof delta.reasoning_content === 'string' ? delta.reasoning_content : '',
  };
}

/**
 * Stream jawaban Puru (generator). Mengikuti format wire OpenAI Chat Completions:
 *   SSE baris "data:{json}", terminal "data: [DONE]".
 * @param {object} opts
 * @param {string} opts.prompt teks pesan (riwayat sudah diflatten oleh pemanggil)
 * @param {string} [opts.model] ID upstream (default 'big-pickle')
 * @yields {{type:'text'|'reasoning', text:string}}
 */
export async function* streamPuru({ prompt, model = PURU_UPSTREAM_MODEL } = {}) {
  const base = getBaseUrl();
  const apiKey = getApiKey();
  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(apiKey ? { 'Authorization': `Bearer ${apiKey}` } : {}),
      'User-Agent': ua(),
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      stream: true,
    }),
  });

  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`Puru HTTP ${res.status}: ${t.slice(0, 200)}`);
  }
  if (!res.body) throw new Error('Puru: respons tanpa body stream');

  // Respons error (bukan SSE) datang sebagai JSON meski HTTP 200.
  if ((res.headers.get('content-type') || '').includes('application/json')) {
    let j;
    try {
      j = await res.json();
    } catch { /* bukan akses JSON — fallback ke pembacaan stream */ }
    if (j && (j.error || j.code)) {
      throw new Error(`Puru menolak: ${j.error?.message ?? JSON.stringify(j).slice(0, 200)}`);
    }
  }

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
      if (!data || data === '[DONE]') continue;
      let chunk;
      try {
        chunk = JSON.parse(data);
      } catch {
        continue; // baris non-JSON lain diabaikan
      }
      const { content, reasoning } = deltaTexts(chunk);
      if (reasoning) yield { type: 'reasoning', text: reasoning };
      if (content) yield { type: 'text', text: content };
    }
  }
}

/**
 * Generate teks penuh (buffered) via Puru.
 * @returns {Promise<{text:string, reasoning:string}>}
 */
export async function generatePuru(opts = {}) {
  let text = '';
  let reasoning = '';
  for await (const d of streamPuru(opts)) {
    if (d.type === 'reasoning') reasoning += d.text;
    else text += d.text;
  }
  if (!text.trim() && !reasoning.trim()) throw new Error('puru mengembalikan konten kosong');
  return { text, reasoning };
}
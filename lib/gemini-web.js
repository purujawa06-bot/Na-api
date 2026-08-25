/**
 * Klien Google Gemini (gemini.google.com) via HTTP murni (Vercel-friendly).
 * Reverse-eng: POST .../StreamGenerate  f.req = [null, "<inner 97 elemen>"]
 *   inner[0][0] = prompt, inner[41] = [kodeModel], inner[42] = namaModel(respons)
 *   inner[4][0][1][0] = teks (akumulatif per chunk)
 * Pemilih model via RPC batchexecute rpcids=L5adhe (87=Flash, 86=Flash-Lite, 94=Pro).
 *
 * TANPA COOKIE (sesi anonim):
 *   StreamGenerate ternyata bisa dipanggil TANPA cookie sama sekali — server
 *   membalas 200 dan menyertakan Set-Cookie NID sendiri. Cookie TIDAK disimpan
 *   di mana pun; setiap permintaan selalu tanpa cookie (stateless penuh).
 *
 * RETRY (khusus Gemini):
 *   Jika permintaan gagal/error/konten kosong -> coba LAGI 1x dengan sesi
 *   anonim segar sebelum menyerah.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
// Template dimuat lazy: dynamic import dibundel webpack (file tersedia di lambda
// Vercel), sedangkan di node murni import JSON tanpa attribute gagal -> fallback fs.
let _tpl = null;
async function getTpl() {
  if (_tpl) return _tpl;
  try {
    _tpl = (await import('./gemini-freq-template.json')).default;
  } catch {
    _tpl = JSON.parse(readFileSync(join(__dirname, 'gemini-freq-template.json'), 'utf8'));
  }
  return _tpl;
}
const BASE = 'https://gemini.google.com';
const STREAM_PATH = '/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate';

// ---------------- Pemetaan model ----------------

/** Pemetaan model OpenAI-style -> kode L5adhe + label Gemini. */
export const MODELS = {
  'gemini-flash': { code: 1, label: '3.6 Flash' },
  'gemini-flash-lite': { code: 0, label: '3.5 Flash-Lite' },
};

function ua() {
  return 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36';
}

function parseResp(text) {
  let modelName = null, answer = '';
  try {
    for (const part of text.split(/\n\d+\n/).slice(1)) {
      const first = part.trim().split('\n')[0];
      if (!first.startsWith('[')) continue;
      let entries;
      try { entries = JSON.parse(first); } catch { continue; }
      for (const e of entries) {
        if (!Array.isArray(e) || e[0] !== 'wrb.fr' || typeof e[2] !== 'string') continue;
        let inner;
        try { inner = JSON.parse(e[2]); } catch { continue; }
        if (typeof inner?.[42] === 'string') modelName = inner[42];
        const t = inner?.[4]?.[0]?.[1]?.[0];
        if (typeof t === 'string' && t.length > answer.length) answer = t;
      }
    }
  } catch {}
  return { modelName, answer };
}

async function buildFreq(prompt) {
  const tpl = await getTpl();
  const inner = JSON.parse(JSON.stringify(tpl.inner));
  inner[0][0] = prompt;
  inner[1] = ['id'];
  return { inner, at: tpl.at };
}

async function setModel(code) {
  try {
    const pad = new Array(95).fill(null);
    pad[94] = (code === 0 || code === 1) ? 1 : 'NULL';
    const payload = JSON.stringify([pad, null, [code]]);
    const freq = JSON.stringify([['L5adhe', payload, null, 'generic']]);
    const body = new URLSearchParams();
    body.set('f.req', freq);
    const url = BASE + '/_/BardChatUi/data/batchexecute?rpcids=L5adhe&source-path=%2Fapp&bl=boq_assistant-bard-web-server_20260821.03_p0&hl=id&rt=c';
    await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8', 'User-Agent': ua(), 'Origin': BASE, 'Referer': BASE + '/' }, body: body.toString() });
  } catch {}
}

/**
 * Panggil StreamGenerate (tanpa cookie sama sekali).
 * @returns {Promise<string>} raw respons
 * @throws bila HTTP bukan 2xx
 */
async function streamGenerate(inner, atToken) {
  const body = new URLSearchParams();
  body.set('f.req', JSON.stringify([null, JSON.stringify(inner)]));
  if (atToken) body.set('at', atToken);
  const headers = {
    'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
    'User-Agent': ua(),
    'Origin': BASE,
    'Referer': BASE + '/',
    'x-goog-ext-73010989-jspb': '[0]',
    'x-goog-ext-525001261-jspb': '[1,null,null,null,"fbb127bbb056c959",null,null,0,[4,5,6,8,4,5,6,8],null,null,1,null,null,1,1,"3DB078"]',
    'x-goog-ext-525005358-jspb': '["4B235E08-4D33-462B-92FA-08C41A4C6AC8",1]',
    'x-goog-ext-73010990-jspb': '[0,0,0]',
  };
  const url = BASE + STREAM_PATH + '?bl=boq_assistant-bard-web-server_20260821.03_p0&f.sid=8086908132051073879&hl=id&_reqid=3129066&rt=c';
  let res = await fetch(url, { method: 'POST', headers, body: body.toString() });
  if (res.status === 400) {
    const text = await res.text();
    const xsrf = text.match(/"48448350":\["xsrf","([^"]+)"/);
    if (xsrf) {
      body.set('at', xsrf[1]);
      res = await fetch(url, { method: 'POST', headers, body: body.toString() });
    }
    if (!res.ok) throw new Error('StreamGenerate HTTP ' + res.status + ': ' + text.slice(0, 200));
    return res.text();
  }
  if (!res.ok) throw new Error('StreamGenerate HTTP ' + res.status + ': ' + (await res.text()).slice(0, 200));
  return res.text();
}

/**
 * Satu percobaan generate lengkap (set model + StreamGenerate + parse).
 * @returns {Promise<{text:string, modelName:string}>}
 */
async function attemptGenerate(prompt, modelCode) {
  const { inner, at } = await buildFreq(prompt);
  await setModel(modelCode);
  const raw = await streamGenerate(inner, at);
  const { modelName, answer } = parseResp(raw);
  if (!answer || !answer.trim()) throw new Error('gemini mengembalikan konten kosong');
  return { text: answer, modelName: modelName || 'gemini' };
}

/**
 * Generate teks via Gemini web (tanpa cookie, sesi anonim stateless).
 * RETRY: gagal -> coba lagi TEPAT 1x dengan sesi anonim baru sebelum menyerah.
 */
export async function generateGemini({ prompt, modelCode = 1 }) {
  let lastErr = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      return await attemptGenerate(prompt, modelCode);
    } catch (err) {
      lastErr = err;
      if (attempt >= 2) break;
      console.error(`[gemini] percobaan 1 gagal (${err?.message ?? err}), coba lagi dengan sesi anonim baru...`);
    }
  }
  throw lastErr ?? new Error('gemini gagal tanpa pesan error');
}

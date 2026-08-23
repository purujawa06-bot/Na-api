/**
 * Klien Google Gemini (gemini.google.com) via HTTP murni (Vercel-friendly).
 * Reverse-eng: POST .../StreamGenerate  f.req = [null, "<inner 97 elemen>"]
 *   inner[0][0] = prompt, inner[41] = [kodeModel], inner[42] = namaModel(respons)
 *   inner[4][0][1][0] = teks (akumulatif per chunk)
 * Pemilih model via RPC batchexecute rpcids=L5adhe (87=Flash, 86=Flash-Lite, 94=Pro).
 * Butuh env GEMINI_COOKIES (string "nm=va; nm2=va2 ...") dari akun Google Gemini.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TPL_PATH = join(__dirname, 'gemini-freq-template.json');
const BASE = 'https://gemini.google.com';
const STREAM_PATH = '/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate';

/** Pemetaan model OpenAI-style -> kode L5adhe + label Gemini. */
export const MODELS = {
  'gemini-flash': { code: 1, label: '3.6 Flash' },
  'gemini-flash-lite': { code: 0, label: '3.5 Flash-Lite' },
};

function getCookies() {
  const c = process.env.GEMINI_COOKIES || '';
  if (c) return c;
  const candidates = [
    join(__dirname, '.gemini-cookies.json'),
    join(__dirname, '..', 'scripts', '.gemini-cookies.json'),
  ];
  for (const p of candidates) {
    try {
      const arr = JSON.parse(readFileSync(p, 'utf8'));
      const s = arr.map((x) => x.name + '=' + x.value).join('; ');
      if (s) return s;
    } catch {}
  }
  return '';
}

function ua() {
  return 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36';
}

function parseResp(text) {
  let modelName = null, answer = '';
  try {
    for (const part of text.split(/\n\d+\n/).slice(1)) {
      const first = part.trim().split('\n')[0];
      if (!first.startsWith('[')) continue;
      for (const e of JSON.parse(first)) {
        if (Array.isArray(e) && e[0] === 'wrb.fr') {
          const inner = JSON.parse(e[2]);
          if (typeof inner?.[42] === 'string') modelName = inner[42];
          const t = inner?.[4]?.[0]?.[1]?.[0];
          if (typeof t === 'string' && t.length > answer.length) answer = t;
        }
      }
    }
  } catch {}
  return { modelName, answer };
}

function buildFreq(prompt) {
  const tpl = JSON.parse(readFileSync(TPL_PATH, 'utf8'));
  const inner = JSON.parse(JSON.stringify(tpl.inner));
  inner[0][0] = prompt;
  inner[1] = ['id'];
  return inner;
}

async function setModel(cookies, code) {
  try {
    const pad = new Array(95).fill(null);
    pad[94] = (code === 0 || code === 1) ? 1 : 'NULL';
    const payload = JSON.stringify([pad, null, [code]]);
    const freq = JSON.stringify([['L5adhe', payload, null, 'generic']]);
    const body = new URLSearchParams();
    body.set('f.req', freq);
    const url = BASE + '/_/BardChatUi/data/batchexecute?rpcids=L5adhe&source-path=%2Fapp&bl=boq_assistant-bard-web-server_20260821.03_p0&hl=id&rt=c';
    await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8', 'Cookie': cookies, 'User-Agent': ua(), 'Origin': BASE, 'Referer': BASE + '/' }, body: body.toString() });
  } catch {}
}

async function streamGenerate(cookies, inner) {
  const tpl = JSON.parse(readFileSync(TPL_PATH, 'utf8'));
  const body = new URLSearchParams();
  body.set('f.req', JSON.stringify([null, JSON.stringify(inner)]));
  if (tpl.at) body.set('at', tpl.at);
  const headers = {
    'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
    'Cookie': cookies,
    'User-Agent': ua(),
    'Origin': BASE,
    'Referer': BASE + '/',
    'x-goog-ext-73010989-jspb': '[0]',
    'x-goog-ext-525001261-jspb': '[1,null,null,null,"fbb127bbb056c959",null,null,0,[4,5,6,8,4,5,6,8],null,null,1,null,null,1,1,"3DB078"]',
    'x-goog-ext-525005358-jspb': '["4B235E08-4D33-462B-92FA-08C41A4C6AC8",1]',
    'x-goog-ext-73010990-jspb': '[0,0,0]',
  };
  const url = BASE + STREAM_PATH + '?bl=boq_assistant-bard-web-server_20260821.03_p0&f.sid=8086908132051073879&hl=id&_reqid=3129066&rt=c';
  const res = await fetch(url, { method: 'POST', headers, body: body.toString() });
  if (!res.ok) throw new Error('StreamGenerate HTTP ' + res.status + ': ' + (await res.text()).slice(0, 200));
  return await res.text();
}

export async function generateGemini({ prompt, modelCode = 1 }) {
  const cookies = getCookies();
  if (!cookies) throw new Error('GEMINI_COOKIES belum diset. Isi cookie string login Google Gemini di env GEMINI_COOKIES.');
  const inner = buildFreq(prompt);
  const raw = await streamGenerate(cookies, inner);
  const { modelName, answer } = parseResp(raw);
  return { text: answer, modelName: modelName || 'gemini' };
}

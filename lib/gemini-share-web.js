/**
 * Klien shared conversation Gemini (gemini.google.com/share/...) via HTTP murni.
 * Reverse-eng: POST batchexecute rpcids=ujx1Bf, body
 *   f.req = [[["ujx1Bf","[null,\"<shareId>\",[4]]",null,"generic"]]]
 * TANPA cookie sama sekali -> HTTP 200 + payload konvo penuh (skid tidak wajib
 * untuk POST ini; hanya dibutuhkan halaman GET, diabaikan di sini).
 *
 * Jawaban assistant diekstrak dari pohon respons: node ["rc_...", ["markdown", ...]]
 * — gabungan string pada indeks [1]. Bila gagal -> retry 1x (sesi anonim segar).
 */
const DEFAULT_SHARE_URL = 'https://gemini.google.com/share/f9e70e37c645?skid=d2cbaf4c-1212-4c5e-a1cb-72c05df8129a';

let reqCounter = Math.floor(Date.now() / 1000) % 1000000;

function ua() {
  return 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36';
}

function extractShareAnswer(rawText) {
  let answer = '';
  for (const part of rawText.split(/\r?\n/)) {
    if (!part.startsWith('[["wrb.fr","ujx1Bf"')) continue;
    let top, inner;
    try {
      top = JSON.parse(part);
      inner = JSON.parse(top[0]?.[2]);
    } catch {
      continue;
    }
    const stack = [inner];
    while (stack.length) {
      const v = stack.pop();
      if (!Array.isArray(v)) continue;
      if (typeof v[0] === 'string' && v[0].startsWith('rc_') && Array.isArray(v[1])) {
        const joined = v[1].filter((s) => typeof s === 'string').join('');
        if (joined.length > answer.length) answer = joined;
      }
      for (const x of v) stack.push(x);
    }
  }
  return answer;
}

function extractQ4uTjAnswer(rawText) {
  for (const part of rawText.split(/\r?\n/)) {
    if (!part.startsWith('[["wrb.fr","q4uTj"')) continue;
    let top, inner;
    try {
      top = JSON.parse(part);
      inner = JSON.parse(top[0]?.[2]);
    } catch {
      continue;
    }
    const obj = Array.isArray(inner) ? JSON.parse(inner[0]) : inner;
    const text = obj?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') ?? '';
    if (text.trim()) return text;
  }
  return '';
}

async function attemptFetch(shareId, message = '') {
  const rpcid = message ? 'q4uTj' : 'ujx1Bf';
  const inner = message
    ? JSON.stringify([null, JSON.stringify({ contents: [{ parts: [{ text: message }] }] }), 1, shareId])
    : `[null,"${shareId}",[4]]`;
  const body = 'f.req=' + encodeURIComponent(JSON.stringify([[[rpcid, inner, null, 'generic']]]));
  const url = `https://gemini.google.com/_/BardChatUi/data/batchexecute?rpcids=${rpcid}&source-path=%2Fshare%2F${shareId}&bl=boq_assistant-bard-web-server_20260824.14_p0&f.sid=1&hl=en-US&_reqid=${++reqCounter}&rt=c`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
      'Content-Length': Buffer.byteLength(body),
      'User-Agent': ua(),
      Origin: 'https://gemini.google.com',
      Referer: 'https://gemini.google.com/',
      Accept: '*/*',
    },
    body,
  });
  if (!res.ok) throw new Error('Gemini Share HTTP ' + res.status + ': ' + (await res.text()).slice(0, 200));
  const rawText = await res.text();
  const answer = message ? extractQ4uTjAnswer(rawText) : extractShareAnswer(rawText);
  if (!answer.trim()) throw new Error('gemini share mengembalikan konten kosong');
  return answer;
}

export async function generateGeminiShare(message = '') {
  const shareUrl = process.env.GEMINI_SHARE_URL || DEFAULT_SHARE_URL;
  const pathname = new URL(shareUrl).pathname;
  const shareId = pathname.split('/').filter(Boolean).pop();
  if (!shareId) throw new Error('GEMINI_SHARE_URL tidak berisi /share/<id>');
  let lastErr = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      return { text: await attemptFetch(shareId, message), modelName: 'gemini-share' };
    } catch (err) {
      lastErr = err;
      if (attempt >= 2) break;
      console.error(`[gemini-share] percobaan 1 gagal (${err?.message ?? err}), coba lagi...`);
    }
  }
  throw lastErr ?? new Error('gemini share gagal tanpa pesan error');
}

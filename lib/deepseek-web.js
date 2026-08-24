/**
 * Klien chat.deepseek.com pure HTTP (serverless/Vercel friendly).
 *
 * Sumber ground truth: scripts/.deepseek-sniff.json (hasil sniffing CDP).
 * - Token auth: Bearer dari localStorage 'userToken' chat.deepseek.com
 *   -> ambil dari env DEEPSEEK_TOKEN (produksi) ATAU auto-grab via CDP Brave (lokal)
 * - Anti-bot PoW: header x-ds-pow-response (algoritma DeepSeekHashV1, lib/deepseek-pow.js)
 * - Completion: POST /api/v0/chat/completion (SSE, patch-based fragments)
 *
 * Format completion payload:
 *   {chat_session_id, parent_message_id, model_type, prompt, ref_file_ids,
 *    thinking_enabled, search_enabled, action, preempt}
 * SSE fragment types: THINK -> reasoning_content, RESPONSE -> content.
 */
import { solvePow } from './deepseek-pow.js';

const CDP_HTTP = process.env.CDP_URL || 'http://127.0.0.1:9222';
const BASE = 'https://chat.deepseek.com';

export const MODELS = {
  'deepseek-chat': { thinking_enabled: false, search_enabled: false },
  'deepseek-reasoner': { thinking_enabled: true, search_enabled: false },
};

// ---------------- Token ----------------

let cachedToken = null;

/** Token akun chat.deepseek.com (hardcoded fallback) */
const DEFAULT_TOKEN = 'BOMT3jOBVI3WW3+fDmFgPlXROV1G1ynFekRDrjHvrhcuqA87NrYasKkK6g4A3Vq0';

/**
 * Ambil bearer token DeepSeek.
 * Prioritas: env DEEPSEEK_TOKEN -> hardcoded -> CDP Brave (lokal).
 */
export async function getUserToken() {
  if (cachedToken) return cachedToken;

  const envToken = process.env.DEEPSEEK_TOKEN?.trim();
  if (envToken) {
    cachedToken = envToken;
    return cachedToken;
  }

  if (DEFAULT_TOKEN) {
    cachedToken = DEFAULT_TOKEN;
    return cachedToken;
  }

  // fallback lokal: tarik token dari Brave via CDP
  const token = await getTokenFromCdp();
  if (token) {
    cachedToken = token;
    return token;
  }
  throw new Error(
    'DEEPSEEK_TOKEN belum diset & CDP tidak tersedia. Set env DEEPSEEK_TOKEN (nilai "value" dari localStorage userToken di chat.deepseek.com)'
  );
}

async function getTokenFromCdp() {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2500);
    const targets = await fetch(`${CDP_HTTP}/json/list`, { signal: controller.signal }).then((r) => r.json());
    clearTimeout(timer);

    let page = targets.find((t) => t.type === 'page' && t.url.includes('chat.deepseek.com'));
    if (!page) return null;

    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    const value = await new Promise((resolve) => {
      ws.onmessage = (e) => {
        const m = JSON.parse(e.data);
        if (m.id === 1) resolve(m.result?.result?.value ?? null);
      };
      ws.send(JSON.stringify({
        id: 1,
        method: 'Runtime.evaluate',
        params: { expression: "localStorage.getItem('userToken')", returnByValue: true },
      }));
      setTimeout(() => resolve(null), 3000);
    });
    ws.close();
    if (!value) return null;
    return JSON.parse(value).value ?? null;
  } catch {
    return null;
  }
}

// ---------------- HTTP wrapper ----------------

/** Header standar klien web DeepSeek (diekspor untuk skrip probe/debug). */
export function baseHeaders(token) {
  return {
    'content-type': 'application/json',
    authorization: `Bearer ${token}`,
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36',
    'x-client-locale': process.env.DEEPSEEK_LOCALE || 'en_US',
    'x-client-version': '2.4.0',
    'x-client-platform': 'web',
    'x-client-bundle-id': 'com.deepseek.chat',
    'x-client-timezone-offset': process.env.DEEPSEEK_TZ_OFFSET || '25200',
    origin: BASE,
    referer: `${BASE}/`,
  };
}

// ---------------- PoW cache (reuse challenge sampai expire, seperti situs asli) ----------------

const POW_SAFETY_MS = 60_000;
const powCache = new Map(); // target_path -> {header, expiresAt}
let powPrefetching = null;

function buildPowHeader(challenge, answer) {
  return Buffer.from(JSON.stringify({
    algorithm: challenge.algorithm,
    challenge: challenge.challenge,
    salt: challenge.salt,
    answer,
    signature: challenge.signature,
    target_path: challenge.target_path,
  })).toString('base64');
}

async function fetchChallenge(token) {
  const res = await fetch(`${BASE}/api/v0/chat/create_pow_challenge`, {
    method: 'POST',
    headers: baseHeaders(token),
    body: JSON.stringify({ target_path: '/api/v0/chat/completion' }),
  }).then((r) => r.json());
  if (res.data?.biz_code !== 0) throw new Error(`pow challenge gagal: ${JSON.stringify(res)}`);
  return res.data.biz_data.challenge;
}

/**
 * Dapatkan header x-ds-pow-response siap pakai.
 * Pakai cache kalau masih valid, kalau tidak solve baru.
 */
export async function getPowHeader(token) {
  const key = '/api/v0/chat/completion';
  const hit = powCache.get(key);
  if (hit && Date.now() < hit.expiresAt) return hit.header;

  const challenge = await fetchChallenge(token);
  const answer = solvePow(challenge);
  const header = buildPowHeader(challenge, answer);
  powCache.set(key, { header, expiresAt: challenge.expire_at - POW_SAFETY_MS });

  // pre-fetch berikutnya di background agar request selanjutnya tanpa tunggu
  schedulePrefetch(token);
  return header;
}

function schedulePrefetch(token) {
  if (powPrefetching) return;
  powPrefetching = setTimeout(async () => {
    powPrefetching = null;
    try {
      const fresh = await fetchChallenge(token);
      const answer = solvePow(fresh);
      powCache.set('/api/v0/chat/completion', {
        header: buildPowHeader(fresh, answer),
        expiresAt: fresh.expire_at - POW_SAFETY_MS,
      });
    } catch { /* abaikan - akan solve saat dibutuhkan */ }
  }, 1000).unref();
}

// ---------------- Session & Completion ----------------

function invalidateToken() {
  cachedToken = null;
}

/**
 * Buat sesi chat baru.
 * @returns {Promise<{id:string}>}
 */
export async function createChatSession(token) {
  const res = await fetch(`${BASE}/api/v0/chat_session/create`, {
    method: 'POST',
    headers: baseHeaders(token),
    body: '{}',
  }).then((r) => r.json());
  if (res.data?.biz_code !== 0) throw new Error(`create session gagal: ${JSON.stringify(res)}`);
  return res.data.biz_data.chat_session;
}

/**
 * Stream completion DeepSeek.
 * @param {object} opts
 * @param {string} opts.prompt pesan terakhir (sudah diflatten)
 * @param {boolean} [opts.thinkingEnabled]
 * @param {boolean} [opts.searchEnabled]
 * @param {string} [opts.modelType] default 'default'
 * @yields {{type:'reasoning'|'content', text:string}} delta teks
 */
export async function* streamCompletion({
  prompt,
  thinkingEnabled = false,
  searchEnabled = false,
  modelType = 'default',
}) {
  // Header PoW yang di-reuse ternyata hanya berlaku ±2 pemakaian di sisi server;
  // pemakaian berikutnya dibalas HTTP 200 + JSON {"code":40301,"msg":"INVALID_POW_RESPONSE"}.
  // Karena itu: bila completion dibalas JSON biz-error PoW, buang cache PoW dan
  // ulangi SEKALI dengan challenge segar sebelum menyerah.
  const POW_TARGET = '/api/v0/chat/completion';
  for (let attempt = 1; attempt <= 2; attempt++) {
    const token = await getUserToken();
    const powHeader = await getPowHeader(token);
    const session = await createChatSession(token);

    const res = await fetch(`${BASE}/api/v0/chat/completion`, {
      method: 'POST',
      headers: { ...baseHeaders(token), 'x-ds-pow-response': powHeader, referer: `${BASE}/a/chat/s/${session.id}` },
      body: JSON.stringify({
        chat_session_id: session.id,
        parent_message_id: null,
        model_type: modelType,
        prompt,
        ref_file_ids: [],
        thinking_enabled: thinkingEnabled,
        search_enabled: searchEnabled,
        action: null,
        preempt: false,
      }),
    });

    if (!res.ok || !res.body) {
      // token kadaluarsa? buang cache supaya request berikutnya ambil ulang
      if (res.status === 401 || res.status === 403) invalidateToken();
      throw new Error(`completion HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
    }

    // Upstream membalas biz-error sebagai HTTP 200 + JSON (bukan SSE).
    // Tanpa cek ini stream "berhasil" tapi kosong — sulit didiagnosis di atas.
    const ct = res.headers.get('content-type') ?? '';
    if (ct.includes('application/json')) {
      const j = await res.json().catch(() => null);
      const code = j?.code;
      const msg = j?.msg ?? 'unknown';
      const isPowRejected = code === 40301;
      if (isPowRejected && attempt < 2) {
        // PoW ditolak: buang header cache & paksa solve challenge baru pada retry
        powCache.delete(POW_TARGET);
        continue;
      }
      throw new Error(`completion gagal (biz ${code ?? '?'}): ${msg}`);
    }

    // state fragmen: [{type}] - THINK=reasoning, lainnya=content
    let lastFragType = 'RESPONSE';
    const mapType = (t) => (t === 'THINK' ? 'reasoning' : 'content');

    const emitContent = async function* (fragments) {
      for (const f of fragments) {
        if (f.content) yield { type: mapType(f.type), text: f.content };
      }
    };

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
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

        let j;
        try { j = JSON.parse(line.slice(5)); } catch { continue; }

        // snapshot penuh awal stream
        if (j.v && typeof j.v === 'object' && j.v.response?.fragments) {
          const frags = j.v.response.fragments.map((f) => ({ type: f.type }));
          lastFragType = frags.at(-1)?.type ?? 'RESPONSE';
          yield* emitContent(j.v.response.fragments);
          continue;
        }

        // fragmen baru di-append (ganti konteks delta)
        if (j.p === 'response/fragments' && j.o === 'APPEND' && Array.isArray(j.v)) {
          yield* emitContent(j.v);
          lastFragType = j.v.at(-1)?.type ?? lastFragType;
          continue;
        }

        // delta eksplisit ke fragmen terakhir
        if (typeof j.p === 'string' && j.p.startsWith('response/fragments/-1/content')) {
          if (typeof j.v === 'string') yield { type: mapType(lastFragType), text: j.v };
          continue;
        }

        // delta telanjang {"v": "..."}
        if (j.p === undefined && typeof j.v === 'string') {
          yield { type: mapType(lastFragType), text: j.v };
          continue;
        }
      }
    }
    return; // stream selesai normal
  }
}

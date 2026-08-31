/**
 * Klien chat.deepseek.com pure HTTP (serverless/Vercel friendly).
 *
 * Sumber ground truth: scripts/.deepseek-sniff.json + probe langsung (scripts/probe-ds2*.mjs).
 * - Auth: Bearer token per-request dari parameter `userID` caller
 *   (nilai "value" dari localStorage `userToken` di chat.deepseek.com).
 * - Anti-bot PoW: header x-ds-pow-response (algoritma DeepSeekHashV1, lib/deepseek-pow.js).
 *   Challenge di-cache per (token, target_path); server hanya menerima ±2 pemakaian
 *   per challenge -> bila dibalas biz-code 40301 INVALID_POW_RESPONSE, solve ulang sekali.
 * - Completion: POST /api/v0/chat/completion (SSE patch-based fragments).
 *   Payload: {chat_session_id, parent_message_id, model_type:"default", prompt,
 *   ref_file_ids, thinking_enabled, search_enabled:false, action:null, preempt:false}.
 * - Multi-turn: konteks HANYA terjaga bila parent_message_id = message_id jawaban
 *   asisten terakhir (event SSE "ready"). parent_message_id null = mulai konteks baru
 *   dalam sesi yang sama. Karena itu API ini mengembalikan chatID + parentID agar
 *   caller bisa melanjutkan percakapan.
 * - Vision: upload gambar ke /api/v0/file/upload_file (FormData field "file",
 *   wajib PoW) -> dapat id file -> dikirim lewat ref_file_ids.
 */
import { solvePow } from './deepseek-pow.js';

const BASE = 'https://chat.deepseek.com';
const POW_COMPLETION = '/api/v0/chat/completion';
const POW_UPLOAD = '/api/v0/file/upload_file';
const POW_SAFETY_MS = 60_000;

/** Cache challenge PoW per token+path: "<token>:<path>" -> {header, expiresAt} */
const powCache = new Map();

function baseHeaders(token, json = true) {
  const h = {
    authorization: `Bearer ${token}`,
    'user-agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36',
    'x-client-locale': 'en_US',
    'x-client-version': '2.4.0',
    'x-client-platform': 'web',
    'x-client-bundle-id': 'com.deepseek.chat',
    origin: BASE,
    referer: `${BASE}/`,
  };
  if (json) h['content-type'] = 'application/json';
  return h;
}

function buildPowHeader(challenge, answer) {
  return Buffer.from(
    JSON.stringify({
      algorithm: challenge.algorithm,
      challenge: challenge.challenge,
      salt: challenge.salt,
      answer,
      signature: challenge.signature,
      target_path: challenge.target_path,
    })
  ).toString('base64');
}

/**
 * Header x-ds-pow-response siap pakai (cache per token+path selama belum expire).
 * ponytail: tanpa prefetch background versi lama; solve saat dibutuhkan saja
 * (latensi +4-8s pada request dingin). Tambahkan prefetch bila latensi terasa.
 */
async function getPowHeader(token, targetPath) {
  const key = `${token}:${targetPath}`;
  const hit = powCache.get(key);
  if (hit && Date.now() < hit.expiresAt) return hit.header;

  const res = await fetch(`${BASE}/api/v0/chat/create_pow_challenge`, {
    method: 'POST',
    headers: baseHeaders(token),
    body: JSON.stringify({ target_path: targetPath }),
  }).then((r) => r.json());
  if (res.data?.biz_code !== 0) throw new Error(`pow challenge gagal: ${JSON.stringify(res).slice(0, 300)}`);

  const challenge = res.data.biz_data.challenge;
  const header = buildPowHeader(challenge, solvePow(challenge));
  powCache.set(key, { header, expiresAt: challenge.expire_at - POW_SAFETY_MS });
  return header;
}

/** Buat sesi chat baru. @returns {Promise<string>} id sesi */
export async function createChatSession(token) {
  const res = await fetch(`${BASE}/api/v0/chat_session/create`, {
    method: 'POST',
    headers: baseHeaders(token),
    body: '{}',
  }).then((r) => r.json());
  if (res.data?.biz_code !== 0) throw new Error(`create session gagal: ${JSON.stringify(res).slice(0, 300)}`);
  return res.data.biz_data.chat_session.id;
}

/**
 * Upload file (gambar) untuk fitur vision.
 * @returns {Promise<{id:string, status:string}>}
 */
export async function uploadFile(token, buffer, filename = 'image.png', contentType = 'image/png') {
  const pow = await getPowHeader(token, POW_UPLOAD);
  const fd = new FormData();
  fd.append('file', new Blob([buffer], { type: contentType }), filename);
  const res = await fetch(`${BASE}${POW_UPLOAD}`, {
    method: 'POST',
    headers: { ...baseHeaders(token, false), 'x-ds-pow-response': pow },
    body: fd,
  }).then((r) => r.json());
  if (res.data?.biz_code !== 0) throw new Error(`upload file gagal: ${JSON.stringify(res).slice(0, 300)}`);
  const d = res.data.biz_data;
  return { id: d.id, status: d.status };
}

/**
 * Stream satu turn completion DeepSeek.
 * @param {object} opts
 * @param {string} opts.token bearer token (userID)
 * @param {string} opts.chatId id sesi
 * @param {string|null} [opts.parentId] message_id jawaban asisten terakhir (null = konteks baru)
 * @param {string} opts.prompt
 * @param {boolean} [opts.thinkingEnabled]
 * @param {string[]} [opts.refFileIds] id file hasil uploadFile (vision)
 * @param {object} [opts.meta] objek output; diisi meta.messageId (id jawaban utk lanjutan) & meta.reasoning
 * @yields {{type:'reasoning'|'content', text:string}}
 */
export async function* streamTurn({ token, chatId, parentId = null, prompt, thinkingEnabled = false, refFileIds = [], meta = {} }) {
  // Server hanya menerima ±2 pemakaian per header PoW -> bila dibalas JSON
  // biz 40301 INVALID_POW_RESPONSE, buang cache & solve ulang SEKALI.
  for (let attempt = 1; attempt <= 2; attempt++) {
    const powHeader = await getPowHeader(token, POW_COMPLETION);
    const res = await fetch(`${BASE}${POW_COMPLETION}`, {
      method: 'POST',
      headers: {
        ...baseHeaders(token),
        'x-ds-pow-response': powHeader,
        referer: `${BASE}/a/chat/s/${chatId}`,
      },
      body: JSON.stringify({
        chat_session_id: chatId,
        parent_message_id: parentId,
        model_type: 'default',
        prompt,
        ref_file_ids: refFileIds,
        thinking_enabled: thinkingEnabled,
        search_enabled: false,
        action: null,
        preempt: false,
      }),
    });

    if (!res.ok || !res.body) {
      if (res.status === 401) throw new Error('userID (token DeepSeek) tidak valid/kadaluarsa');
      throw new Error(`completion HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
    }

    // Biz-error datang sebagai HTTP 200 + JSON (bukan SSE).
    const ct = res.headers.get('content-type') ?? '';
    if (ct.includes('application/json')) {
      const j = await res.json().catch(() => null);
      if (j?.code === 40301 && attempt < 2) {
        powCache.delete(`${token}:${POW_COMPLETION}`);
        continue;
      }
      throw new Error(`completion gagal (biz ${j?.code ?? '?'}): ${j?.msg ?? 'unknown'}`);
    }

    // state fragmen: THINK=reasoning, lainnya=content
    let lastFragType = 'RESPONSE';
    const mapType = (t) => (t === 'THINK' ? 'reasoning' : 'content');

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

        // snapshot penuh awal stream / event ready: ambil message_id jawaban
        if (j.v && typeof j.v === 'object' && j.v.response) {
          if (j.v.response.message_id != null) meta.messageId = j.v.response.message_id;
          const frags = j.v.response.fragments;
          if (Array.isArray(frags)) {
            lastFragType = frags.at(-1)?.type ?? 'RESPONSE';
            for (const f of frags) if (f.content) yield { type: mapType(f.type), text: f.content };
          }
          continue;
        }

        // fragmen baru di-append
        if (j.p === 'response/fragments' && j.o === 'APPEND' && Array.isArray(j.v)) {
          lastFragType = j.v.at(-1)?.type ?? lastFragType;
          for (const f of j.v) if (f.content) yield { type: mapType(f.type), text: f.content };
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

/** boolean/string "true" -> boolean */
function truthy(v, dflt = false) {
  if (v === undefined || v === null || v === '') return dflt;
  return v === true || v === 'true' || v === 1 || v === '1';
}

/**
 * Endpoint-level helper: jalankan satu turn (opsional upload gambar utk vision),
 * mode streaming SSE atau JSON lengkap.
 * @returns {Promise<Response>} Response SSE (stream=true) atau akan di-resolve JSON oleh route
 */
export async function askDeepSeek({ token, prompt, chatId, parentId, thinking, imageUrl, stream }) {
  if (!token) throw Object.assign(new Error('Parameter userID wajib diisi'), { status: 400 });
  if (!prompt) throw Object.assign(new Error('Parameter prompt wajib diisi'), { status: 400 });
  if (chatId && !parentId) {
    throw Object.assign(
      new Error('Untuk melanjutkan chat, kirim chatID + parentID (message_id jawaban terakhir dari respons sebelumnya)'),
      { status: 400 }
    );
  }

  const thinkingEnabled = truthy(thinking);
  const wantStream = truthy(stream);
  const meta = {};

  // vision: unduh gambar lalu upload ke DeepSeek
  let refFileIds = [];
  if (imageUrl) {
    if (!/^https?:\/\//i.test(imageUrl)) throw Object.assign(new Error('Parameter image harus URL http(s)'), { status: 400 });
    const imgRes = await fetch(imageUrl, {
      headers: { 'user-agent': baseHeaders('')['user-agent'] },
      signal: AbortSignal.timeout(20_000),
    });
    if (!imgRes.ok) throw Object.assign(new Error(`Gagal mengunduh gambar (HTTP ${imgRes.status})`), { status: 400 });
    const buf = Buffer.from(await imgRes.arrayBuffer());
    const ct = imgRes.headers.get('content-type')?.split(';')[0] || 'image/png';

    // ponytail: DeepSeek cek ekstensi file; URL tanpa ekstensi (mis. /image/png) tak diterima.
    const extMap = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/jpg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif' };
    let name = imageUrl.split('/').pop()?.split('?')[0] || 'image';
    if (!/\.[a-z0-9]{2,5}$/i.test(name)) name = `image${extMap[ct] || '.png'}`;

    const up = await uploadFile(token, buf, name, ct);
    refFileIds = [up.id];
  }

  const sessionId = chatId || (await createChatSession(token));

  if (!wantStream) {
    let content = '';
    let reasoning = '';
    for await (const part of streamTurn({ token, chatId: sessionId, parentId: parentId ?? null, prompt, thinkingEnabled, refFileIds, meta })) {
      if (part.type === 'reasoning') reasoning += part.text;
      else content += part.text;
    }
    return {
      success: true,
      source: imageUrl ? 'deepseek-web-vision' : 'deepseek-web',
      chatID: sessionId,
      parentID: meta.messageId ?? null,
      content: content.trim(),
      ...(reasoning.trim() ? { reasoning: reasoning.trim() } : {}),
    };
  }

  // streaming SSE sederhana: meta -> reasoning/content -> done -> [DONE]
  const encoder = new TextEncoder();
  const customStream = new TransformStream();
  const writer = customStream.writable.getWriter();
  const send = (obj) => writer.write(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));

  (async () => {
    try {
      await send({ type: 'meta', chatID: sessionId, model: imageUrl ? 'deepseek-vision' : thinkingEnabled ? 'deepseek-reasoner' : 'deepseek-chat' });
      for await (const part of streamTurn({ token, chatId: sessionId, parentId: parentId ?? null, prompt, thinkingEnabled, refFileIds, meta })) {
        await send({ type: part.type, text: part.text });
      }
      await send({ type: 'done', chatID: sessionId, parentID: meta.messageId ?? null });
      await writer.write(encoder.encode('data: [DONE]\n\n'));
    } catch (err) {
      await send({ type: 'error', error: err.message }).catch(() => {});
    } finally {
      try { await writer.close(); } catch { /* sudah tertutup */ }
    }
  })();

  return new Response(customStream.readable, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}

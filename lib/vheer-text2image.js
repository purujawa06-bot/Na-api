/**
 * Klien Vheer Text-to-Image (reverse-engineered).
 *
 * Alur (dikonfirmasi via sniffing + live test):
 *   1. `/app/api/creem/moderation/prompt` -> decision + token
 *   2. `/app/api/vheer/upload` (multipart `params` AES-GCM) -> data_enc -> { code, imageId, provider, model }
 *   3. `/app/api/vheer/status` (JSON `params` AES-GCM) -> data_enc -> { status, downloadUrls[] }
 *
 * Kunci AES-GCM diambil dari bundle frontend vheer (PBKDF2 + AES-GCM, IV 12B prepended).
 * Berjalan anonim (user_id:""), model gratis: flux_dev.
 */

const BASE = 'https://vheer.com/app/api/vheer';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36';

// pbkdf2 params diambil persis dari bundle frontend
const PASS = 'vH33r_2025_AES_GCM_S3cur3_K3y_9X7mP4qR8nT2wE5yU1oI6aS3dF7gH0jK9lZ';
const SALT = 'vheer-salt-2024';
const ITER = 10000;

const subtle = globalThis.crypto?.subtle;
let cachedKey = null;

async function getKey() {
  if (cachedKey) return cachedKey;
  const base = await subtle.importKey('raw', new TextEncoder().encode(PASS), 'PBKDF2', false, ['deriveBits']);
  const bits = await subtle.deriveBits(
    { name: 'PBKDF2', salt: new TextEncoder().encode(SALT), iterations: ITER, hash: 'SHA-256' },
    base,
    256
  );
  cachedKey = await subtle.importKey('raw', bits, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
  return cachedKey;
}

export async function encryptClientPayload(obj) {
  const key = await getKey();
  const data = new TextEncoder().encode(JSON.stringify(obj));
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const ct = await subtle.encrypt({ name: 'AES-GCM', iv }, key, data);
  const out = new Uint8Array(iv.length + ct.byteLength);
  out.set(iv, 0);
  out.set(new Uint8Array(ct), iv.length);
  return Buffer.from(out).toString('base64');
}

export async function decryptClientPayload(b64) {
  const key = await getKey();
  const buf = Buffer.from(b64, 'base64');
  const iv = buf.slice(0, 12);
  const ct = buf.slice(12);
  const pt = await subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
  return JSON.parse(new TextDecoder().decode(pt));
}

async function moderation(prompt) {
  const r = await fetch('https://vheer.com/app/api/creem/moderation/prompt', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': UA },
    body: JSON.stringify({ prompt, type: 1 }),
  });
  return r.json();
}

async function upload(payload) {
  const params = await encryptClientPayload(payload);
  const fd = new FormData();
  fd.append('params', params);
  const r = await fetch(`${BASE}/upload`, {
    method: 'POST',
    headers: { 'user-agent': UA },
    body: fd,
  });
  const j = await r.json();
  if (j.code !== 200 || !j.data_enc) {
    const err = new Error(j.msg || 'Upload gagal');
    err.status = 502;
    throw err;
  }
  return decryptClientPayload(j.data_enc);
}

async function checkStatus(payload) {
  const params = await encryptClientPayload(payload);
  const r = await fetch(`${BASE}/status`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': UA },
    body: JSON.stringify({ params }),
  });
  const j = await r.json();
  if (!j.data_enc) throw new Error('Status: tidak ada data');
  return decryptClientPayload(j.data_enc);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Generate gambar dari teks via vheer.
 * @param {object} opts
 * @param {string} opts.prompt - prompt (wajib)
 * @param {string} [opts.model='flux_dev'] - id model
 * @param {string} [opts.aspectRatio='1:1'] - aspek (1:1, 16:9, 9:16, auto)
 * @param {number} [opts.numImages=1]
 * @param {number} [opts.maxWaitMs=120000]
 * @param {(event:string, data:object)=>void} [opts.onProgress]
 * @returns {Promise<{images:string[], model:string, taskId:string}>}
 */
export async function textToImage({
  prompt,
  model = 'flux_dev',
  aspectRatio = '1:1',
  numImages = 1,
  maxWaitMs = 120000,
  onProgress,
}) {
  if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
    const err = new Error('Parameter prompt wajib diisi');
    err.status = 400;
    throw err;
  }
  prompt = prompt.trim();

  onProgress?.('moderation', {});
  const mod = await moderation(prompt).catch(() => ({ decision: 'allow' }));
  if (mod.decision !== 'allow') {
    const err = new Error(mod.message || 'Prompt ditolak oleh moderasi konten');
    err.status = 400;
    throw err;
  }

  const uploadPayload = {
    prompt,
    positive_prompts: prompt,
    type: 1,
    aspect_ratio: aspectRatio,
    selected_model: model,
    model_name: model,
    cost_credit: 0,
    user_id: '',
    num_images: Number(numImages) || 1,
    lan_code: 'en',
    member_type: 0,
    ...(mod.token ? { moderation_token: mod.token } : {}),
  };

  onProgress?.('uploading', {});
  const up = await upload(uploadPayload);
  onProgress?.('processing', { taskId: up.code, model: up.model });

  const statusPayload = {
    type: 1,
    code: up.code,
    user_id: '',
    cost_credit: 0,
    num_images: Number(numImages) || 1,
    third_party_type: up.provider || 'self_hosted',
    model: up.model || model,
  };

  const deadline = Date.now() + maxWaitMs;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    await sleep(6000);
    const s = await checkStatus(statusPayload);
    onProgress?.('poll', { status: s.status });
    if (s.status === 'success') {
      return { images: s.downloadUrls || [], model: up.model || model, taskId: up.code };
    }
    if (s.status === 'failed' || s.status === 'error') {
      const err = new Error(`Generasi gagal: ${s.message || s.status}`);
      err.status = 502;
      throw err;
    }
    if (Date.now() > deadline) {
      const err = new Error('Generasi gambar kehabisan waktu');
      err.status = 504;
      throw err;
    }
  }
}

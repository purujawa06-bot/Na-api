/**
 * Klien Raphael AI Text-to-Video (reverse-engineered, anonim gratis).
 *
 * Alur (dikonfirmasi via sniffing bundle Next.js + live test):
 *   1. `POST /api/video/anon/identity` (body `{}`) -> Set-Cookie `raphael-anonymous-video`
 *   2. `POST /api/video/anon/ticket` (body `{prompt, aspect}`) -> `{ ticket, wait_ms }`
 *   3. Tunggu `wait_ms`, `POST /api/video/anon/redeem` (body `{ticket}`) -> `{ job_id }`
 *      (terlalu cepat -> 409 `QUEUE_NOT_READY` + sisa `wait_ms`)
 *   4. Poll `GET /api/video/anon/job/{job_id}` -> `{ status, tasks[] }`
 *      (video jadi ada di `tasks[].assets.videoUrl`)
 *
 * Gratisan terkunci di sisi server: MiniMax H3 Turbo 480P ~4 detik.
 * `aspect` bebas: 16:9, 9:16, 1:1, 4:3, 3:4, 21:9.
 * Limit ~2 video/hari per identitas + limit IP (`ANON_DAILY_LIMIT`).
 */

const BASE = 'https://raphael.app';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36';

export const VIDEO_MODEL = 'minimax-h3-turbo';
export const VIDEO_ASPECTS = ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'];

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function baseHeaders(cookie) {
  const h = {
    'content-type': 'application/json',
    'user-agent': UA,
    origin: BASE,
    referer: `${BASE}/ai-video-generator`,
    accept: 'application/json',
  };
  if (cookie) h.cookie = cookie;
  return h;
}

function extractAnonCookie(res) {
  let raw = [];
  if (typeof res.headers.getSetCookie === 'function') {
    raw = res.headers.getSetCookie();
  } else {
    const single = res.headers.get('set-cookie');
    if (single) raw = [single];
  }
  for (const c of raw) {
    const m = c.match(/raphael-anonymous-video=[^;]+/);
    if (m) return m[0];
  }
  return '';
}

/** Normalisasi cookie: terima string penuh atau nilai telanjang. */
export function normalizeCookie(cookie) {
  if (!cookie || typeof cookie !== 'string') return '';
  const first = cookie.split(';')[0].trim();
  if (!first) return '';
  if (first.includes('=')) return first;
  return `raphael-anonymous-video=${first}`;
}

async function readJson(res) {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * Minta identitas anonim baru (wajib sebelum minta tiket).
 * @returns {Promise<{cookie:string}>} cookie `raphael-anonymous-video=...`
 */
export async function requestIdentity() {
  const r = await fetch(`${BASE}/api/video/anon/identity`, {
    method: 'POST',
    headers: baseHeaders(),
    body: '{}',
  });
  const cookie = extractAnonCookie(r);
  if (!r.ok || !cookie) {
    if (r.status === 429) throw httpError(429, 'Limit identitas Raphael tercapai (UPLOAD_RATE_LIMITED)');
    throw httpError(502, 'Gagal membuat identitas anonim Raphael');
  }
  return { cookie };
}

/**
 * Minta tiket antre video dari teks.
 * @param {object} opts
 * @param {string} opts.prompt - deskripsi video (wajib, 1-2000 karakter)
 * @param {string} [opts.aspect='16:9'] - rasio aspek (16:9, 9:16, 1:1, 4:3, 3:4, 21:9)
 * @param {string} [opts.cookie=''] - cookie identitas (otomatis dibuat bila kosong)
 * @returns {Promise<{ticket:string, wait_ms:number, cookie:string, aspect:string}>}
 */
export async function requestTicket({ prompt, aspect = '16:9', cookie = '' }) {
  if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
    throw httpError(400, 'Parameter prompt wajib diisi');
  }
  prompt = prompt.trim();
  if (prompt.length > 2000) {
    throw httpError(400, 'Parameter prompt terlalu panjang (maks 2000 karakter)');
  }
  if (!VIDEO_ASPECTS.includes(aspect)) {
    throw httpError(400, `Parameter aspect tidak valid. Pilihan: ${VIDEO_ASPECTS.join(', ')}`);
  }
  if (!cookie) {
    ({ cookie } = await requestIdentity());
  }

  const r = await fetch(`${BASE}/api/video/anon/ticket`, {
    method: 'POST',
    headers: baseHeaders(cookie),
    body: JSON.stringify({ prompt, aspect }),
  });
  const j = await readJson(r);
  if (!r.ok || j?.code !== 0 || !j?.data?.ticket) {
    const msg = j?.message || `Ticket gagal (HTTP ${r.status})`;
    if (r.status === 400) throw httpError(400, msg);
    throw httpError(502, msg);
  }
  return {
    ticket: j.data.ticket,
    wait_ms: Number(j.data.wait_ms) || 0,
    cookie,
    aspect,
  };
}

/**
 * Tukar tiket menjadi job_id (panggil setelah wait_ms habis).
 * @param {object} opts
 * @param {string} opts.ticket - tiket dari requestTicket (wajib)
 * @param {string} opts.cookie - cookie identitas (wajib)
 * @returns {Promise<{job_id:string}>} job_id untuk polling status
 */
export async function redeemTicket({ ticket, cookie }) {
  if (!ticket || typeof ticket !== 'string' || !ticket.trim()) {
    throw httpError(400, 'Parameter ticket wajib diisi');
  }
  cookie = normalizeCookie(cookie);
  if (!cookie) {
    throw httpError(400, 'Parameter cookie wajib diisi');
  }

  const r = await fetch(`${BASE}/api/video/anon/redeem`, {
    method: 'POST',
    headers: baseHeaders(cookie),
    body: JSON.stringify({ ticket: ticket.trim() }),
  });
  const j = await readJson(r);
  if (!r.ok || j?.code !== 0 || !j?.data?.job_id) {
    const msg = j?.message || `Redeem gagal (HTTP ${r.status})`;
    if (msg === 'QUEUE_NOT_READY') {
      const err = httpError(409, 'Antrean belum siap (QUEUE_NOT_READY), coba lagi setelah wait_ms');
      err.wait_ms = Number(j?.data?.wait_ms) || 15000;
      throw err;
    }
    if (msg === 'QUEUE_TICKET_INVALID') throw httpError(400, 'Tiket tidak valid/kedaluwarsa (QUEUE_TICKET_INVALID)');
    if (msg === 'ANON_DAILY_LIMIT') throw httpError(429, 'Limit harian video gratis tercapai (ANON_DAILY_LIMIT)');
    if (r.status === 400) throw httpError(400, msg);
    throw httpError(502, msg);
  }
  return { job_id: j.data.job_id };
}

const PROCESSING = new Set(['processing', 'pending_dispatch', 'pending_payment']);
const FAILED = new Set(['failed', 'dispatch_failed', 'payment_failed', 'credits_deduction_failed']);

/**
 * Cek status job video.
 * @param {object} opts
 * @param {string} opts.job_id - job ID dari redeemTicket (wajib)
 * @param {string} opts.cookie - cookie identitas (wajib)
 * @returns {Promise<{status:string, upstream_status:string, progress:number|null, videos:string[], thumbnails:string[], next_poll_ms:number|null}>}
 */
export async function getJobStatus({ job_id, cookie }) {
  if (!job_id || typeof job_id !== 'string' || !job_id.trim()) {
    throw httpError(400, 'Parameter job_id wajib diisi');
  }
  cookie = normalizeCookie(cookie);
  if (!cookie) {
    throw httpError(400, 'Parameter cookie wajib diisi');
  }

  const r = await fetch(`${BASE}/api/video/anon/job/${encodeURIComponent(job_id.trim())}`, {
    method: 'GET',
    headers: baseHeaders(cookie),
  });
  if (r.status === 404) {
    throw httpError(404, 'Job tidak ditemukan (mungkin sudah dibersihkan server)');
  }
  const j = await readJson(r);
  if (!r.ok || j?.code !== 0 || !j?.data) {
    throw httpError(502, j?.message || `Status job gagal (HTTP ${r.status})`);
  }
  const d = j.data;
  const upstream = d.status || 'processing';
  const tasks = Array.isArray(d.tasks) ? d.tasks : [];
  const done = tasks.filter((t) => t?.meta?.status === 'success' && t?.assets?.videoUrl);
  const videos = done.map((t) => t.assets.videoUrl);
  const thumbnails = done.map((t) => t.assets.thumbnailUrl || '');

  let status;
  if (PROCESSING.has(upstream)) status = 'processing';
  else if (upstream === 'partial') status = 'partial';
  else if (FAILED.has(upstream)) status = 'failed';
  else if (videos.length > 0) status = 'complete';
  else status = 'processing';

  return {
    status,
    upstream_status: upstream,
    progress: typeof d.progress === 'number' ? d.progress : null,
    videos,
    thumbnails,
    next_poll_ms: typeof d.nextPollMs === 'number' ? d.nextPollMs : null,
  };
}

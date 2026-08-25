/**
 * Downloader YouTube via API internal vidssave.com (id.vidssave.com) tanpa browser.
 *
 * Alur reverse-engineering (hasil sniffing chunk JS id.vidssave.com, Agustus 2026):
 *   Semua request POST ke https://api.vidssave.com/api/contentsite_api/<path>
 *   dengan Content-Type application/x-www-form-urlencoded. Body WAJIB memuat:
 *     auth=20250901majwlqo&domain=api-ak.vidssave.com
 *   (konstanta ini diekstrak dari chunk _next/static/chunks/144-*.js, fungsi Ar).
 *
 *   1. POST media/parse  body {origin:'source', link:<url youtube>}
 *      -> {status:1, data:{title, thumbnail, duration, resources:[{resource_content,
 *          quality:'360P', format:'MP4', type:'video'|'audio', size}]}}
 *      Catatan: field yang dipakai untuk langkah berikutnya adalah resource_content
 *      (blob terenkripsi), BUKAN resource_id.
 *   2. POST media/download body {request:<resource_content>, no_encrypt:1}
 *      -> {status:1, data:{task_id}}
 *   3. GET media/download_query?task_id=<task_id>
 *      -> respons SSE-ish teks: "event: <nama>\ndata: {...json...}"
 *      Polling sampai data.download_link tersedia.
 */

const API_BASE = 'https://api.vidssave.com/api/contentsite_api';
const AUTH = '20250901majwlqo';
const DOMAIN = 'api-ak.vidssave.com';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

function baseHeaders() {
  return {
    'Content-Type': 'application/x-www-form-urlencoded',
    Origin: 'https://id.vidssave.com',
    Referer: 'https://id.vidssave.com/',
    'User-Agent': UA,
  };
}

async function postForm(path, extra = {}) {
  const body = new URLSearchParams({ auth: AUTH, domain: DOMAIN, ...extra });
  const res = await fetch(`${API_BASE}/${path}`, {
    method: 'POST',
    headers: baseHeaders(),
    body,
    signal: AbortSignal.timeout(20000),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Respons tidak valid dari vidssave (${path}): HTTP ${res.status}`);
  }
  if (json.status !== 1) {
    throw new Error(json.msg || json.status_code || `Upstream menolak permintaan (${path})`);
  }
  return json.data;
}

/** Parse metadata + daftar kualitas dari sebuah URL YouTube. */
export async function parseYoutube(url) {
  return postForm('media/parse', { origin: 'source', link: url });
}

/**
 * Ambil link download final untuk satu resource.
 * Polling media/download_query sampai download_link siap (maks ~40 detik).
 */
export async function resolveDownloadLink(resourceContent) {
  const started = await postForm('media/download', {
    request: resourceContent,
    no_encrypt: '1',
  });
  const taskId = started?.task_id;
  if (!taskId) throw new Error('task_id tidak diterima dari vidssave');

  const queryUrl = `${API_BASE}/media/download_query?auth=${AUTH}&domain=${DOMAIN}&task_id=${encodeURIComponent(taskId)}`;
  const deadline = Date.now() + 40000;

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2500));
    let text;
    try {
      const res = await fetch(queryUrl, {
        headers: { Referer: 'https://id.vidssave.com/', 'User-Agent': UA },
        signal: AbortSignal.timeout(15000),
      });
      text = await res.text();
    } catch {
      continue; // retry poll berikutnya
    }

    // Respons berformat SSE: baris "data: {json}"
    const dataLine = text.split('\n').find((l) => l.startsWith('data:'));
    if (!dataLine) continue;
    let payload;
    try {
      payload = JSON.parse(dataLine.slice(5).trim());
    } catch {
      continue;
    }
    if (payload.download_link) return payload.download_link;
    if (payload.status && payload.status !== 'success' && payload.progress === undefined) {
      throw new Error(`Download gagal di sisi vidssave: ${payload.status}`);
    }
  }
  throw new Error('Timeout menunggu link download dari vidssave');
}

/** Pilih satu resource sesuai preferensi type/quality (fallback ke terbaik yang ada). */
function pickResource(resources, type, quality) {
  let pool = resources.filter((r) =>
    type === 'audio' ? r.type === 'audio' : r.type === 'video'
  );
  if (pool.length === 0) pool = resources;

  if (quality) {
    const exact = pool.find(
      (r) => r.quality.toLowerCase() === quality.toLowerCase()
    );
    if (exact) return exact;
  }

  // Default praktis: MP4 <=1080P tertinggi dulu (hindari WEBM raksasa 4K),
  // kalau kosong baru ambil kualitas tertinggi apa pun formatnya.
  const rank = (r) => parseInt(r.quality, 10) || 0;
  const sensible = pool.filter((r) => rank(r) <= 1080 && r.format === 'MP4');
  const pool2 = sensible.length ? sensible : pool;
  return [...pool2].sort((a, b) => rank(b) - rank(a))[0] || null;
}

/**
 * Fungsi utama: parse URL YouTube dan selesaikan satu link download.
 * @param {string} url - URL YouTube (watch / youtu.be / shorts).
 * @param {{type?: 'video'|'audio', quality?: string}} opts
 */
export async function downloadYoutube(url, opts = {}) {
  const parsed = await parseYoutube(url);
  const { title, thumbnail, duration, resources = [], id } = parsed;
  if (!resources.length) throw new Error('Tidak ada resource yang tersedia untuk URL ini');

  const type = opts.type === 'audio' ? 'audio' : 'video';
  const picked = pickResource(resources, type, opts.quality);
  if (!picked) throw new Error('Kualitas yang diminta tidak tersedia');

  const link = await resolveDownloadLink(picked.resource_content);

  return {
    id,
    title,
    thumbnail,
    duration,
    qualities: resources.map((r) => ({
      quality: r.quality,
      format: r.format,
      type: r.type,
      size: r.size,
    })),
    download: {
      url: link,
      quality: picked.quality,
      format: picked.format,
      type: picked.type,
      size: picked.size,
    },
  };
}

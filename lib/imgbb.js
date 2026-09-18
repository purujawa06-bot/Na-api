/**
 * Client imgbb.com (Chevereto) — upload gambar gratis tanpa API key.
 * Alur (hasil reverse-engineering ibb.js):
 *   1. GET https://imgbb.com/ -> ambil `auth_token` fresh (berubah tiap load).
 *   2. POST https://imgbb.com/json (multipart) dengan field:
 *      source (file blob / URL), type (file/url), action=upload,
 *      timestamp (ms), auth_token, expiration?, title?, description?
 *   3. Respon JSON: status_code 200 -> image.url / display_url / thumb / medium / delete_url.
 */

const BASE = 'https://imgbb.com';
const JSON_API = 'https://imgbb.com/json';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

// Nilai expiration persis seperti <option> di homepage imgbb.
const EXPIRATIONS = new Set([
  'PT5M', 'PT15M', 'PT30M', 'PT1H', 'PT3H', 'PT6H', 'PT12H',
  'P1D', 'P2D', 'P3D', 'P4D', 'P5D', 'P6D',
  'P1W', 'P2W', 'P3W',
  'P1M', 'P2M', 'P3M', 'P4M', 'P5M', 'P6M',
]);

export const MAX_FILE_SIZE = 32 * 1024 * 1024; // 32 MB (limit free imgbb)

export function validateExpiration(exp) {
  if (exp == null || exp === '') return null;
  if (!EXPIRATIONS.has(exp)) {
    throw new Error(
      'Expiration tidak valid. Pilihan: PT5M, PT15M, PT30M, PT1H, PT3H, PT6H, PT12H, P1D-P6D, P1W-P3W, P1M-P6M'
    );
  }
  return exp;
}

async function getAuthToken() {
  const res = await fetch(BASE + '/', {
    headers: { 'user-agent': UA, accept: 'text/html' },
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`Gagal ambil halaman imgbb.com (HTTP ${res.status})`);
  const html = await res.text();
  const token = (html.match(/auth_token="([^"]+)"/) || [])[1];
  if (!token) throw new Error('auth_token tidak ditemukan di halaman imgbb.com');
  return token;
}

function pickResult(json) {
  if (json.status_code !== 200 || !json.image) {
    const msg =
      (json.error && json.error.message) || json.status_txt || 'Upload ke imgbb gagal';
    const err = new Error(`imgbb: ${msg}`);
    err.statusCode = json.status_code;
    throw err;
  }
  const img = json.image;
  return {
    url: img.url,
    display_url: img.display_url || img.url,
    thumb_url: (img.thumb && img.thumb.url) || null,
    medium_url: (img.medium && img.medium.url) || null,
    viewer_url: img.url_viewer || null,
    delete_url: img.delete_url || null,
    filename: img.filename || null,
    mime: (img.image && img.image.mime) || null,
    extension: img.extension_name || null,
    width: img.width ?? null,
    height: img.height ?? null,
    size: img.size ?? null,
    size_formatted: img.size_formatted || null,
    expiration: img.expiration ?? 0,
    title: img.title || null,
  };
}

async function postUpload(form) {
  const res = await fetch(JSON_API, {
    method: 'POST',
    headers: {
      'user-agent': UA,
      accept: 'application/json',
      origin: BASE,
      referer: BASE + '/',
    },
    body: form,
  });
  let json;
  try {
    json = await res.json();
  } catch {
    throw new Error(`imgbb merespon non-JSON (HTTP ${res.status})`);
  }
  return pickResult(json);
}

function applyCommon(form, { expiration, title, description }) {
  form.append('action', 'upload');
  form.append('timestamp', String(Date.now()));
  if (expiration) form.append('expiration', expiration);
  if (title) form.append('title', title);
  if (description) form.append('description', description);
}

/**
 * Upload gambar dari URL publik.
 * @param {string} imageUrl - URL http/https gambar.
 * @param {object} [opts] - { expiration, title, description }
 */
export async function uploadFromUrl(imageUrl, opts = {}) {
  const expiration = validateExpiration(opts.expiration);
  const token = await getAuthToken();
  const form = new FormData();
  form.append('source', imageUrl);
  form.append('type', 'url');
  form.append('auth_token', token);
  applyCommon(form, { expiration, title: opts.title, description: opts.description });
  return postUpload(form);
}

/**
 * Upload file gambar langsung (buffer).
 * @param {Buffer|Uint8Array} buffer - isi file.
 * @param {string} filename - nama file (mis. foto.png).
 * @param {string} mimetype - mis. image/png.
 * @param {object} [opts] - { expiration, title, description }
 */
export async function uploadFile(buffer, filename, mimetype, opts = {}) {
  const expiration = validateExpiration(opts.expiration);
  if (!buffer || buffer.length === 0) throw new Error('File kosong');
  if (buffer.length > MAX_FILE_SIZE) throw new Error('File melebihi 32 MB (limit imgbb free)');
  const token = await getAuthToken();
  const form = new FormData();
  form.append('source', new Blob([buffer], { type: mimetype || 'application/octet-stream' }), filename || 'upload.jpg');
  form.append('type', 'file');
  form.append('auth_token', token);
  applyCommon(form, { expiration, title: opts.title, description: opts.description });
  return postUpload(form);
}

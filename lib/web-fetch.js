/**
 * Web fetch dengan pagination wajib (offset + length) untuk AI agent.
 *
 * - Fetch URL publik (http/https) lalu ubah jadi teks bersih.
 * - HTML di-strip via cheerio (buang script/style/noscript) + collapse whitespace.
 * - Konten diiris pakai offset + length (wajib) agar halaman besar bisa
 *   dibaca bertahap tanpa jebol konteks.
 * - Proteksi SSRF: tolak host lokal/privat (localhost, 127.x, 10.x,
 *   192.168.x, 172.16-31.x, 169.254.x, ::1, .local/.internal).
 */

import * as cheerio from 'cheerio';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const FETCH_TIMEOUT_MS = 20000;
const MAX_BODY_BYTES = 2 * 1024 * 1024; // 2MB cap (hemat RAM serverless)
export const MAX_LENGTH = 20000;

function isBlockedHost(hostname) {
  const h = String(hostname || '').toLowerCase().replace(/\.$/, '');
  if (!h) return true;
  if (['localhost', '::1', '[::1]'].includes(h)) return true;
  if (h === '0.0.0.0') return true;
  if (h.endsWith('.local') || h.endsWith('.internal')) return true;
  if (h === '169.254.169.254' || h === '[fd00:ec2::254]') return true;
  // IPv4 privat / loopback / link-local
  const v4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [, a, b] = v4.map(Number);
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 0) return true;
  }
  // IPv6 privat/loopback sederhana
  if (h.startsWith('fc00:') || h.startsWith('fd00:') || h.startsWith('fe80:')) return true;
  return false;
}

function htmlToText(html) {
  const $ = cheerio.load(html);
  $('script, style, noscript, svg, canvas, template').remove();
  const raw = $('body').length ? $('body').text() : $.root().text();
  return cleanText(raw);
}

function cleanText(s) {
  return String(s ?? '')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((l) => l.replace(/[ \t\x0b\f]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Fetch URL lalu iris teks pakai offset + length.
 * @param {string} url - URL publik http/https
 * @param {object} opts
 * @param {number} opts.offset - posisi awal (wajib, >= 0)
 * @param {number} opts.length - jumlah karakter (wajib, 1..20000)
 */
export async function fetchWebChunk(url, opts = {}) {
  const rawUrl = String(url ?? '').trim();
  if (!rawUrl) throw Object.assign(new Error('Parameter url wajib diisi'), { status: 400 });

  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw Object.assign(new Error('Parameter url tidak valid (harus http/https)'), { status: 400 });
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw Object.assign(new Error('Parameter url harus http/https'), { status: 400 });
  }
  if (isBlockedHost(parsed.hostname)) {
    throw Object.assign(new Error('Host lokal/privat ditolak (proteksi SSRF)'), { status: 400 });
  }

  const offset = Number(opts.offset);
  const length = Number(opts.length);
  if (!Number.isInteger(offset) || offset < 0) {
    throw Object.assign(new Error('Parameter offset wajib diisi (integer >= 0)'), { status: 400 });
  }
  if (!Number.isInteger(length) || length < 1 || length > MAX_LENGTH) {
    throw Object.assign(new Error(`Parameter length wajib diisi (integer 1..${MAX_LENGTH})`), {
      status: 400,
    });
  }

  let res;
  try {
    res = await fetch(parsed.toString(), {
      headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml,application/json,text/*;q=0.9,*/*;q=0.8' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      redirect: 'follow',
    });
  } catch (e) {
    throw Object.assign(new Error(`Gagal fetch URL: ${e.message}`), { status: 502 });
  }
  if (!res.ok) {
    throw Object.assign(new Error(`Upstream HTTP ${res.status}`), { status: 502 });
  }

  const ctype = (res.headers.get('content-type') || '').toLowerCase();
  const buf = Buffer.from(await res.arrayBuffer());
  const slicedBuf = buf.length > MAX_BODY_BYTES ? buf.subarray(0, MAX_BODY_BYTES) : buf;
  const rawText = slicedBuf.toString('utf-8');

  let text;
  if (ctype.includes('text/html') || (!ctype.includes('json') && /<\s*html|<\s*body|<\s*div|<\s*p[\s>]/i.test(rawText.slice(0, 2000)))) {
    text = htmlToText(rawText);
  } else {
    text = cleanText(rawText);
  }
  if (!text) text = '(konten kosong / tidak ada teks terbaca)';

  const total_length = text.length;
  const content = offset >= total_length ? '' : text.slice(offset, offset + length);

  return {
    url: parsed.toString(),
    final_url: res.url || parsed.toString(),
    content_type: ctype || null,
    total_length,
    offset,
    length: content.length,
    requested_length: length,
    has_more: offset + length < total_length,
    truncated_body: buf.length > MAX_BODY_BYTES,
    content,
  };
}

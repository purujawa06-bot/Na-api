/**
 * @title Web Fetch Paginated
 * @summary Ambil isi halaman web sebagai teks dengan pagination wajib (offset + length).
 * @description Fetch URL publik (http/https) lalu ubah jadi teks bersih
 *              (HTML di-strip via cheerio, whitespace dirapikan) dan diiris
 *              pakai offset + length yang WAJIB diisi — agar halaman besar
 *              bisa dibaca bertahap tanpa jebol konteks AI agent. Host
 *              lokal/privat ditolak (proteksi SSRF). Mendukung method GET
 *              (query param) dan POST (body JSON {url, offset, length}).
 * @method GET
 * @path /api/agent-tools/web-fetch
 * @param {string} query.url - URL publik http/https yang mau di-fetch (wajib).
 * @param {number} query.offset - Posisi awal karakter (wajib, integer >= 0).
 * @param {number} query.length - Jumlah karakter yang diminta (wajib, integer 1..20000).
 * @response json
 * @example
 * fetch('https://puruboy-api.vercel.app/api/agent-tools/web-fetch?url=https%3A%2F%2Fexample.com&offset=0&length=5000')
 *     .then(res => res.json())
 *     .then(data => console.log(data));
 */
import { fetchWebChunk, MAX_LENGTH } from '../../../../lib/web-fetch.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

function parseParams(input) {
  const url = String(input.url ?? '').trim();
  if (!url) {
    return { error: { success: false, error: 'Parameter url wajib diisi' }, status: 400 };
  }

  // offset & length WAJIB — tolak bila kosong (jangan default diam-diam).
  const rawOffset = input.offset;
  const rawLength = input.length;
  if (rawOffset === undefined || rawOffset === null || String(rawOffset).trim() === '') {
    return { error: { success: false, error: 'Parameter offset wajib diisi (integer >= 0)' }, status: 400 };
  }
  if (rawLength === undefined || rawLength === null || String(rawLength).trim() === '') {
    return {
      error: { success: false, error: `Parameter length wajib diisi (integer 1..${MAX_LENGTH})` },
      status: 400,
    };
  }

  const offset = Number(String(rawOffset).trim());
  const length = Number(String(rawLength).trim());

  if (!Number.isInteger(offset) || offset < 0) {
    return { error: { success: false, error: 'Parameter offset wajib diisi (integer >= 0)' }, status: 400 };
  }
  if (!Number.isInteger(length) || length < 1 || length > MAX_LENGTH) {
    return {
      error: { success: false, error: `Parameter length wajib diisi (integer 1..${MAX_LENGTH})` },
      status: 400,
    };
  }

  return { params: { url, offset, length } };
}

async function runFetch({ url, offset, length }) {
  try {
    const result = await fetchWebChunk(url, { offset, length });
    return Response.json({ success: true, status: 'success', ...result });
  } catch (err) {
    const status = err?.status === 400 ? 400 : 502;
    return Response.json(
      { success: false, status: 'error', error: err.message, httpStatus: status },
      { status }
    );
  }
}

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const parsed = parseParams({
    url: searchParams.get('url'),
    offset: searchParams.get('offset'),
    length: searchParams.get('length'),
  });
  if (parsed.error) {
    return Response.json(parsed.error, { status: parsed.status });
  }
  return runFetch(parsed.params);
}

export async function POST(req) {
  let body;
  try {
    body = await req.json();
  } catch {
    return Response.json(
      { success: false, error: 'Body harus JSON: {"url": "...", "offset": 0, "length": 5000}' },
      { status: 400 }
    );
  }
  const parsed = parseParams(body ?? {});
  if (parsed.error) {
    return Response.json(parsed.error, { status: parsed.status });
  }
  return runFetch(parsed.params);
}

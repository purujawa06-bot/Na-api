/**
 * Penyimpanan cookie sesi scraper (Yahoo/Baidu) PERSISTEN di Firebase RTDB.
 *
 * Kenapa persisten: serverless tiap request bisa jalan di proses baru
 * (cookie memori hilang) -> tanpa ini setiap request harus panen cookie
 * via homepage (= request ekstra + pola bot yang mudah di-throttle).
 * Dengan cookie bersama: 1x panen, dipakai ulang semua instance hingga
 * invalid/kedaluwarsa, lalu refresh otomatis 1x.
 *
 * Skema RTDB: {PATH}/{key}.json = { at, jar: {nama: nilai} }
 */

const FIREBASE_DB_URL = 'https://puru-69425-default-rtdb.firebaseio.com/';

/** TTL cookie tersimpan 24 jam + cache baca Firebase 10 menit. */
const COOKIE_TTL_MS = 24 * 60 * 60 * 1000;
const COOKIE_CACHE_MS = 10 * 60 * 1000;

/** Cache memori: `${path}:${key}` -> { at, jar }. */
const memCache = new Map();

/** Key RTDB aman (tanpa . $ # [ ] /). */
export function safeKey(s) {
  return String(s).replace(/[^a-zA-Z0-9-]/g, '_');
}

function memGet(path, key) {
  const hit = memCache.get(`${path}:${key}`);
  if (!hit) return null;
  if (Date.now() - hit.at > COOKIE_CACHE_MS) {
    memCache.delete(`${path}:${key}`);
    return null;
  }
  return hit.jar;
}

function memSet(path, key, jar) {
  memCache.set(`${path}:${key}`, { at: Date.now(), jar });
}

/** Ambil cookie: memori -> Firebase (fail-open: gagal -> {}). */
export async function loadCookies(path, key) {
  const mem = memGet(path, key);
  if (mem && Object.keys(mem).length) return { ...mem };
  let jar = {};
  try {
    const res = await fetch(`${FIREBASE_DB_URL}${path}/${key}.json`, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) {
      const body = await res.json();
      if (body && typeof body.jar === 'object' && Date.now() - (body.at || 0) < COOKIE_TTL_MS) {
        jar = body.jar;
      }
    }
  } catch {
    /* abaikan -> jar kosong */
  }
  memSet(path, key, jar);
  return { ...jar };
}

/** Simpan cookie ke memori + Firebase (gagal tulis diabaikan). */
export async function persistCookies(path, key, jar) {
  memSet(path, key, { ...jar });
  try {
    await fetch(`${FIREBASE_DB_URL}${path}/${key}.json`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ at: Date.now(), jar }),
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    /* abaikan */
  }
}

/** Ambil daftar nama cookie dari respons (set-cookie). */
export function harvestCookies(res, jar) {
  const list = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  for (const c of list) {
    const m = c.match(/^([^=;]+)=([^;]*)/);
    if (m) jar[m[1]] = m[2];
  }
  return jar;
}

/** Render jar menjadi header Cookie. */
export function cookieHeader(jar) {
  return Object.entries(jar)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
}

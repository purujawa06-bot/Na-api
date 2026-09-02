/**
 * Cookie jar persisten via Firebase Realtime Database (REST, public rules).
 *
 * Gemini web/share mengembalikan Set-Cookie (cookie guest/anonymous, mis. NID)
 * tapi lib lama sengaja mengabaikannya (stateless). Jar ini menangkap cookie
 * tersebut, menyimpannya per-model di RTDB, lalu memakainya lagi pada request
 * berikutnya agar sesi guest bertahan.
 *
 * Penyimpanan RTDB public -> tiap model disimpan di path <model> sebagai array
 * cookie (format serialisasi tough-cookie via toJSON()). Tanpa auth (rules
 * .read/.write = true), akses lewat REST .json.
 *
 * Dua arah:
 *   - getCookieHeader(model): baca jar -> string header `Cookie` utk request.
 *   - saveCookies(model, res): ambil header `set-cookie` dr respons, refresh
 *     jar, lalu PUT balik ke RTDB.
 */
import { CookieJar, Cookie } from 'tough-cookie';

// Hardcoded sesuai konfirmasi user (DB public, tanpa env).
const RTDB_BASE = 'https://puru-69425-default-rtdb.firebaseio.com';
// Domain target Gemini supaya key cookie .google.com tetap ikut.
const ORIGIN = 'https://gemini.google.com';

async function readJarArray(model) {
  try {
    const res = await fetch(`${RTDB_BASE}/${model}.json`, { cache: 'no-store' });
    if (!res.ok) return null;
    const data = await res.json();
    return Array.isArray(data) ? data : null;
  } catch {
    return null;
  }
}

async function getJar(model) {
  const arr = await readJarArray(model);
  const jar = new CookieJar();
  if (!arr) return { jar, arr };
  for (const raw of arr) {
    const cookie = Cookie.fromJSON(raw);
    if (!cookie) continue;
    try { await jar.setCookie(cookie, ORIGIN); } catch {}
  }
  return { jar, arr };
}

export async function getCookieHeader(model) {
  const { jar } = await getJar(model);
  const cookies = await jar.getCookies(ORIGIN);
  return cookies.map((c) => `${c.key}=${c.value}`).join('; ') || null;
}

export async function saveCookies(model, res) {
  const setCookies = res.headers?.getSetCookie?.() ?? [];
  if (!setCookies.length && (await readJarArray(model)) === null) return null;
  const { jar } = await getJar(model);
  for (const raw of setCookies) {
    try { await jar.setCookie(raw, ORIGIN); } catch {}
  }
  const all = await jar.getCookies(ORIGIN);
  const payload = all.map((c) => c.toJSON());
  await fetch(`${RTDB_BASE}/${model}.json`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).catch((e) => console.error(`[firebase-cookie] PUT ${model} gagal`, e?.message));
  return payload;
}

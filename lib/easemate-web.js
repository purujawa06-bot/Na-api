/**
 * Klien EaseMate AI (www.easemate.ai/webapp/chat) via HTTP murni (Vercel-friendly).
 * Reverse-eng (CDP sniff pinia store `app-chat` + bundle CjBRe6_v.js / BuMessZ_.js):
 *
 *   1. Register identitas anon:
 *      POST https://api.easemate.ai/api2/task/identity_id  body {}
 *      -> { code:200, data:{ identity_id } }   (identity_id 64-hex)
 *   2. Chat anonim:
 *      POST https://api.easemate.ai/api2/stream/no_session_operation
 *      body (URUTAN KUNCI PENTING, meniru browser):
 *        {"model_id":6,"operation_info":{"id":10000,"operation":"CUSTOMIZE"},
 *         "object_info":[{"text_info":{"text":"..."}}]}
 *      Respons SSE: baris `data:{json}` dgn { code, data } — bila code 200,
 *      `data` berupa JSON-string { search, answer, inference, finished, cost }.
 *      answer = konten, inference = reasoning.
 *
 * Sign (header `Sign` + `Timestamp`) dihitung oleh WASM chat_generator.wasm
 * milik situs yang dijalankan di atas shim wasm-bindgen minimal — lihat
 * lib/easemate-wasm.js (base64) dan shim Vc()/Eo()/Uo() di bawah.
 * Detail kritis: globalThis harus "kelihatan seperti window" (instanceof Window,
 * location.origin, localStorage['app-main'] berisi visitorId+identityId).
 *
 * Error server yang dikenal:
 *   4004 Error sign · 2004 Header parameter is missing (identitas tak valid)
 *   6101 kuota token gratis harian habis (dihitung PER-IP, bukan per-device)
 */

import { EASEMATE_WASM_B64 } from './easemate-wasm.js';

const API_BASE = 'https://api.easemate.ai';
const CHAT_PATH = '/api2/stream/no_session_operation';
const REGISTER_PATH = '/api2/task/identity_id';

/** model_id internal EaseMate (dari bundle UI): 6=GPT-5 mini? terverifikasi 6 & 3 hidup. */
export const EASEMATE_MODEL_ID = 6;

// ---------------- wasm-bindgen shim ----------------

let qe = null; // exports WASM
let bo = null; // cache Uint8Array memory
let Pr = null; // cache DataView memory
let qr = 0; // panjang string tulisan terakhir
const md = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
const __ = new TextEncoder;

function gn() {
  if (bo === null || bo.byteLength === 0) bo = new Uint8Array(qe.memory.buffer);
  return bo;
}
function fo() {
  if (Pr === null || Pr.buffer.detached === !0 || (Pr.buffer.detached === void 0 && Pr.buffer !== qe.memory.buffer)) Pr = new DataView(qe.memory.buffer);
  return Pr;
}
function No(e, t) { e = e >>> 0; return md.decode(gn().subarray(e, e + t)); }
function _n(e, t, a) {
  if (a === void 0) {
    const s = __.encode(e), u = t(s.length, 1) >>> 0;
    gn().subarray(u, u + s.length).set(s); qr = s.length; return u;
  }
  let o = e.length, n = t(o, 1) >>> 0;
  const i = gn(); let _ = 0;
  for (; _ < o; _++) { const s = e.charCodeAt(_); if (s > 127) break; i[n + _] = s; }
  if (_ !== o) {
    _ !== 0 && (e = e.slice(_));
    n = a(n, o, o = _ + e.length * 3, 1) >>> 0;
    const s = gn().subarray(n + _, n + o), u = __.encodeInto(e, s);
    _ += u.written || 0; n = a(n, o, _, 1) >>> 0;
  }
  qr = _; return n;
}
function Hr(e) { return e == null; }

// ponytail: override globalThis (Window/location/localStorage) seumur proses;
// Node tidak memakainya, tapi bila suatu hari bentrok -> pindahkan ke VM context.
globalThis.Window = class Window {};
Object.setPrototypeOf(globalThis, Window.prototype);
globalThis.location = { origin: 'https://www.easemate.ai' };
globalThis.self = globalThis;

const rnd = (n) => Array.from({ length: n }, () => '0123456789abcdef'[Math.floor(Math.random() * 16)]).join('');
const VISITOR_ID = rnd(32);

// state localStorage dinamis: awal tanpa identityId, diisi setelah register
let appMain = JSON.stringify({ visitorId: VISITOR_ID });
globalThis.localStorage = {
  getItem: (k) => (k === 'app-main' ? appMain : null),
  setItem: (k, v) => { if (k === 'app-main') appMain = v; },
};

function Vc() {
  const s = {};
  s.wbg = {};
  s.wbg.__wbg_call_13410aac570ffff7 = function (...u) { return Uo((c, m) => c.call(m), u); };
  s.wbg.__wbg_getItem_9fc74b31b896f95a = function (...u) {
    return Uo((c, m, l, p) => {
      const d = m.getItem(No(l, p)), h = Hr(d) ? 0 : _n(d, qe.__wbindgen_malloc, qe.__wbindgen_realloc), f = qr;
      fo().setInt32(c + 4, f, !0); fo().setInt32(c + 0, h, !0);
    }, u);
  };
  s.wbg.__wbg_instanceof_Window_12d20d558ef92592 = function (u) { return u instanceof Window; };
  s.wbg.__wbg_localStorage_9330af8bf39365ba = function (...u) {
    return Uo((c) => { const m = c.localStorage; return Hr(m) ? 0 : Eo(m); }, u);
  };
  // KRITIS: return raw externref u.location (JANGAN dibungkus Eo())
  s.wbg.__wbg_location_92d89c32ae076cab = function (u) { return u.location; };
  s.wbg.__wbg_log_6c7b5f4f00b8ce3f = function () {};
  s.wbg.__wbg_newnoargs_254190557c45b4ec = function (u, c) { return new Function(No(u, c)); };
  s.wbg.__wbg_origin_00892013881c6e2b = function (...u) {
    return Uo((c, m) => {
      const l = m.origin, p = _n(l, qe.__wbindgen_malloc, qe.__wbindgen_realloc), d = qr;
      fo().setInt32(c + 4, d, !0); fo().setInt32(c + 0, p, !0);
    }, u);
  };
  s.wbg.__wbg_static_accessor_GLOBAL_8921f820c2ce3f12 = function () { return Hr(globalThis) ? 0 : Eo(globalThis); };
  s.wbg.__wbg_static_accessor_GLOBAL_THIS_f0a4409105898184 = function () { return Hr(globalThis) ? 0 : Eo(globalThis); };
  s.wbg.__wbg_static_accessor_SELF_995b214ae681ff99 = function () { return Hr(globalThis.self) ? 0 : Eo(globalThis.self); };
  s.wbg.__wbg_static_accessor_WINDOW_cde3890479c675ea = function () { return Hr(globalThis.window ?? globalThis) ? 0 : Eo(globalThis.window ?? globalThis); };
  s.wbg.__wbg_stringify_b98c93d0a190446a = function (...u) { return Uo((c) => JSON.stringify(c), u); };
  s.wbg.__wbg_wbindgenisnull_f3037694abe4d97a = function (u) { return u === null; };
  s.wbg.__wbg_wbindgenisobject_307a53c6bd97fbf8 = function (u) { const c = u; return typeof c == 'object' && c !== null; };
  s.wbg.__wbg_wbindgenisstring_d4fa939789f003b0 = function (u) { return typeof u == 'string'; };
  s.wbg.__wbg_wbindgenisundefined_c4b71d073b92f3c5 = function (u) { return u === void 0; };
  s.wbg.__wbg_wbindgenstringget_0f16a6ddddef376f = function (u, c) {
    const m = c, l = typeof m == 'string' ? m : void 0;
    let p = 0, d = 0;
    Hr(l) || ((p = _n(l, qe.__wbindgen_malloc, qe.__wbindgen_realloc)), (d = qr));
    fo().setInt32(u + 4, d, !0); fo().setInt32(u + 0, p, !0);
  };
  s.wbg.__wbg_wbindgenthrow_451ec1a8469d7eb6 = function (u, c) { throw new Error(No(u, c)); };
  s.wbg.__wbindgen_cast_2241b6af4c4b2941 = function (u, c) { return No(u, c); };
  s.wbg.__wbindgen_init_externref_table = function () {
    const u = qe.__wbindgen_export_2, c = u.grow(4);
    u.set(c + 0, void 0); u.set(c + 1, null); u.set(c + 2, !0); u.set(c + 3, !1);
  };
  return s;
}
function Eo(e) { const t = qe.__externref_table_alloc(); return qe.__wbindgen_export_2.set(t, e), t; }
function Uo(e, t) { try { return e.apply(null, t); } catch (a) { const o = Eo(a); qe.__wbindgen_exn_store(o); } }

async function initWasm() {
  if (qe) return;
  const buf = Buffer.from(EASEMATE_WASM_B64, 'base64');
  const { instance } = await WebAssembly.instantiate(buf, Vc());
  qe = instance.exports;
  bo = null; Pr = null;
  qe.__wbindgen_start && qe.__wbindgen_start();
}

const tsNano = () => (BigInt(Date.now()) * 1000000n + BigInt(Math.floor(Math.random() * 1e6))).toString();

/** Hitung pasangan {sign, timestamp} untuk satu body objek via WASM. */
async function getSigns(bodyObj) {
  await initWasm();
  const m = tsNano();
  const l = _n(m, qe.__wbindgen_malloc, qe.__wbindgen_realloc);
  const p = qr;
  const d = qe.get_signs(bodyObj, l, p);
  return JSON.parse(No(d[0], d[1]));
}

function baseHeaders(identityId) {
  const h = {
    Accept: 'text/event-stream',
    'Cache-Control': 'no-cache',
    'client-type': 'web',
    'content-type': 'application/json;charset=UTF-8',
    'client-name': 'chatpdf',
    'device-uuid': VISITOR_ID,
    'device-type': 'web',
    'device-platform': 'Windows,Brave',
    Lang: 'en',
    Language: 'en-US',
    Site: 'www.easemate.ai',
  };
  if (identityId) h['identity-id'] = identityId;
  return h;
}

// ---------------- identitas anon (cache per proses) ----------------

let cachedIdentity = null;

async function registerIdentity() {
  const signs = await getSigns({});
  const headers = baseHeaders(null);
  headers.Sign = signs.sign; headers.Timestamp = signs.timestamp;
  headers.Accept = 'application/json';
  const res = await fetch(API_BASE + REGISTER_PATH, { method: 'POST', headers, body: '{}' });
  const j = await res.json().catch(() => null);
  const id = j?.data?.identity_id;
  if (!id) throw new Error(`EaseMate register identitas gagal: HTTP ${res.status} ${JSON.stringify(j).slice(0, 150)}`);
  cachedIdentity = id;
  appMain = JSON.stringify({ visitorId: VISITOR_ID, identityId: id });
  console.log(`[easemate] identitas baru: ${id.slice(0, 12)}…`);
  return id;
}

async function getIdentity() {
  return cachedIdentity ?? (await registerIdentity());
}

// ---------------- chat ----------------

/**
 * Stream jawaban EaseMate (generator).
 * @param {object} opts
 * @param {string} opts.prompt teks pesan (riwayat sudah diflatten pemanggil)
 * @param {number} [opts.modelId] ID model internal EaseMate (default 6)
 * @yields {{type:'text'|'reasoning', text:string}}
 */
export async function* streamEasemate({ prompt, modelId = EASEMATE_MODEL_ID } = {}) {
  // percobaan kedua otomatis bila identitas cache ditolak (2004)
  for (let attempt = 0; attempt < 2; attempt++) {
    const identityId = await getIdentity();
    // urutan kunci body HARUS persis gaya browser (model_id dulu)
    const bodyStr = JSON.stringify({
      model_id: modelId,
      operation_info: { id: 10000, operation: 'CUSTOMIZE' },
      object_info: [{ text_info: { text: prompt } }],
    });
    const signs = await getSigns(JSON.parse(bodyStr));
    const headers = baseHeaders(identityId);
    headers.Sign = signs.sign; headers.Timestamp = signs.timestamp;

    const res = await fetch(API_BASE + CHAT_PATH, { method: 'POST', headers, body: bodyStr });

    if (!res.ok) {
      const t = await res.text().catch(() => '');
      throw new Error(`EaseMate HTTP ${res.status}: ${t.slice(0, 200)}`);
    }
    // penolakan awal dikirim sebagai JSON biasa (mis. 6101 kuota per-IP habis)
    if ((res.headers.get('content-type') || '').includes('application/json')) {
      const j = await res.json().catch(() => ({}));
      if (j?.code === 2004 && attempt === 0) { cachedIdentity = null; continue; }
      throw new Error(`EaseMate menolak (${j?.code ?? res.status}): ${j?.message ?? JSON.stringify(j).slice(0, 200)}`);
    }
    if (!res.body) throw new Error('EaseMate: respons tanpa body stream');

    let any = false;
    const reader = res.body.getReader();
    const decoder = new TextDecoder('utf-8');
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
        const data = line.slice(5).trim();
        if (!data || data === '[DONE]') continue;
        let ev;
        try { ev = JSON.parse(data); } catch { continue; }
        if (ev.code !== 200) throw new Error(`EaseMate stream error ${ev.code}: ${ev.message ?? ''}`.trim());
        if (typeof ev.data !== 'string' || !ev.data) continue;
        let chunk;
        try { chunk = JSON.parse(ev.data); } catch { continue; }
        if (typeof chunk.inference === 'string' && chunk.inference) { any = true; yield { type: 'reasoning', text: chunk.inference }; }
        if (typeof chunk.answer === 'string' && chunk.answer) { any = true; yield { type: 'text', text: chunk.answer }; }
      }
    }
    if (!any) throw new Error('easemate mengembalikan konten kosong');
    return;
  }
}

/**
 * Generate teks penuh (buffered) via EaseMate.
 * @returns {Promise<{text:string, reasoning:string}>}
 */
export async function generateEasemate(opts = {}) {
  let text = '';
  let reasoning = '';
  for await (const d of streamEasemate(opts)) {
    if (d.type === 'reasoning') reasoning += d.text;
    else text += d.text;
  }
  if (!text.trim() && !reasoning.trim()) throw new Error('easemate mengembalikan konten kosong');
  return { text, reasoning };
}

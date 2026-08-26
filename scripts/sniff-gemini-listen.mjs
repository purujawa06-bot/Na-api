#!/usr/bin/env node
/**
 * CDP Sniffer tombol "Listen" (read-aloud) di gemini.google.com/app —
 * alur lengkap: kirim prompt -> tunggu jawaban -> klik tombol read-aloud ->
 * tangkap payload RPC XqA3Ic yang VALID dari percakapan asli.
 *
 * Usage: node scripts/sniff-gemini-listen.mjs
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CDP_HTTP = process.env.CDP_URL || 'http://127.0.0.1:9222';
const OUT = join(dirname(fileURLToPath(import.meta.url)), '.gemini-listen-sniff.json');
const PROMPT = process.env.GPROMPT || 'Sebutkan 3 fakta menarik tentang laut dalam dalam satu paragraf singkat.';

let msgId = 0;
const pending = new Map();
let ws;
const listeners = [];

function sendCmd(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++msgId;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

function onMessage(raw) {
  const msg = JSON.parse(raw);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) reject(new Error(`${msg.error.message} ${msg.error.data || ''}`));
    else resolve(msg.result);
  }
  listeners.forEach((fn) => fn(msg));
}

function onEvent(fn) {
  listeners.push(fn);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function evalJs(expression) {
  const res = await sendCmd('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (res.exceptionDetails) throw new Error(JSON.stringify(res.exceptionDetails).slice(0, 500));
  return res.result.value;
}

async function connect() {
  const targets = await (await fetch(`${CDP_HTTP}/json/list`)).json();
  const pages = targets.filter((t) => t.type === 'page');
  console.log('[i] tab terbuka:', pages.map((p) => p.url.slice(0, 60)));
  let page = pages.find((p) => p.url.includes('gemini.google.com/app'));
  if (!page) {
    console.log('[i] tidak ada tab /app, buka baru ...');
    page = await (
      await fetch(`${CDP_HTTP}/json/new?url=https://gemini.google.com/app`, { method: 'PUT' })
    ).json();
    await sleep(10000);
  }
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = rej;
  });
  ws.onmessage = (e) => onMessage(e.data);
  return page;
}

// ---------- capture ----------
const captures = [];
const seen = new Map();

function keep(url, type) {
  try {
    const u = new URL(url);
    if (u.protocol === 'data:' || u.protocol === 'blob:') return false;
    if (/batchexecute/.test(u.pathname)) return true;
    if (type === 'media') return true;
    if (/audio|tts|speech|voice/i.test(u.pathname)) return true;
    return false;
  } catch {
    return false;
  }
}

onEvent((msg) => {
  if (msg.method === 'Network.requestWillBeSent') {
    const r = msg.params.request;
    const rt = msg.params.type || '';
    if (!keep(r.url, rt)) return;
    seen.set(msg.params.requestId, {
      url: r.url.slice(0, 2000),
      method: r.method,
      type: rt,
      postData: r.postData ? r.postData.slice(0, 20000) : null,
      ts: Date.now(),
    });
  }
  if (msg.method === 'Network.responseReceived') {
    const meta = seen.get(msg.params.requestId);
    if (!meta) return;
    meta.status = msg.params.response.status;
    meta.mimeType = msg.params.response.mimeType;
  }
  if (msg.method === 'Network.loadingFinished') {
    const meta = seen.get(msg.params.requestId);
    if (!meta) return;
    seen.delete(msg.params.requestId);

    // simpan body utk batchexecute teks agar bisa dibedah
    const wantBody = !meta.type || meta.type !== 'media';
    const push = (body) => {
      meta.responseBody = body ? String(body).slice(0, 600000) : null;
      captures.push(meta);
      console.log(`[+] ${meta.method} ${meta.status} [${meta.type}] ${meta.url.slice(0, 100)}`);
    };
    if (wantBody) {
      sendCmd('Network.getResponseBody', { requestId: msg.params.requestId })
        .then((b) => push(b.base64Encoded ? Buffer.from(b.body, 'base64').toString('utf8') : b.body))
        .catch(() => push(null));
    } else {
      push(null);
    }
  }
});

// ---------- main ----------
async function main() {
  console.log(`[i] konek ke ${CDP_HTTP} ...`);
  const page = await connect();
  console.log(`[i] pakai tab: ${page.url.slice(0, 80)}`);

  await sendCmd('Network.enable');
  await sendCmd('Page.enable');
  await sendCmd('Runtime.enable');

  if (!page.url.includes('/app')) {
    await sendCmd('Page.navigate', { url: 'https://gemini.google.com/app' });
    await sleep(8000);
  }

  // 1) kirim prompt via contenteditable
  const sent = await evalJs(`(() => {
    const ed = document.querySelector('div[contenteditable=\"true\"], rich-textarea div[contenteditable]');
    if (!ed) return 'NO_EDITOR';
    ed.focus();
    document.execCommand('insertText', false, ${JSON.stringify(PROMPT)});
    return 'typed';
  })()`);
  console.log('[i] ketik prompt:', sent);
  if (sent === 'NO_EDITOR') {
    console.log('[x] textarea tidak ketemu (mungkin belum login?)');
    process.exit(1);
  }
  await sleep(800);

  const clickedSend = await evalJs(`(() => {
    const btn = [...document.querySelectorAll('button')]
      .find(b => b.getAttribute('aria-label') && /send|kirim/i.test(b.getAttribute('aria-label')) && !b.disabled);
    if (!btn) return 'NO_SEND_BTN';
    btn.click();
    return 'sent';
  })()`);
  console.log('[i] kirim:', clickedSend);

  // 2) tunggu generasi selesai: tombol send muncul lagi + tombol stop hilang
  let done = false;
  for (let i = 0; i < 40; i++) {
    await sleep(1500);
    done = await evalJs(`(() => {
      const stopBtn = [...document.querySelectorAll('button')].find(b =>
        (b.getAttribute('aria-label')||'').match(/stop|hentikan/i));
      const listenBtns = [...document.querySelectorAll('button, [role=\"button\"]')].filter(b =>
        b.offsetParent && /listen|read aloud|dengar|bacakan/i.test(b.getAttribute('aria-label')||''));
      return !stopBtn && listenBtns.length > 0;
    })()`);
    if (done) break;
  }
  console.log('[i] generasi selesai:', done);
  if (!done) {
    writeFileSync(OUT, JSON.stringify(captures, null, 2));
    console.log('[x] timeout menunggu jawaban. cek', OUT);
    process.exit(1);
  }
  await sleep(3000);

  // 3) klik tombol read-alount pertama
  const lbl = await evalJs(`(() => {
    const btns = [...document.querySelectorAll('button, [role=\"button\"]')]
      .filter(b => b.offsetParent && /listen|read aloud|dengar|bacakan/i.test(b.getAttribute('aria-label')||''));
    btns[0].click();
    return btns.map(b => b.getAttribute('aria-label')).join(', ');
  })()`);
  console.log('[i] klik listen:', lbl);

  console.log('[i] tunggu 15s menangkap request audio ...');
  await sleep(15000);

  writeFileSync(OUT, JSON.stringify(captures, null, 2));
  console.log(`\n[i] total ${captures.length} request -> ${OUT}`);

  // ringkas XqA3Ic
  for (const c of captures) {
    if (c.url.includes('XqA3Ic')) {
      console.log('\n===== XqA3Ic =====');
      console.log((c.postData || '').slice(0, 4000));
      console.log('--- resp head:', (c.responseBody || '').slice(0, 400));
    }
  }
  // cari media/audio lain
  for (const c of captures) {
    if (c.type === 'media' || /audio|tts|speech/i.test(c.url)) {
      console.log('\n===== MEDIA =====');
      console.log(c.method, c.status, c.url.slice(0, 300));
    }
  }
  process.exit(0);
}

main().catch((e) => {
  console.error('[x]', e.message);
  process.exit(1);
});

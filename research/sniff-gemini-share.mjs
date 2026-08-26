#!/usr/bin/env node
/**
 * CDP Sniffer untuk gemini.google.com/share/<id> — reverse engineering
 * cara mengambil audio TTS dari halaman share percakapan.
 *
 * Usage:
 *   node scripts/sniff-gemini-share.mjs [URL_SHARE]
 *   env GSHARE_URL=... node scripts/sniff-gemini-share.mjs
 */

import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CDP_HTTP = process.env.CDP_URL || 'http://127.0.0.1:9222';
const SHARE_URL =
  process.env.GSHARE_URL || process.argv[2] || 'https://gemini.google.com/share/57a78e75b77a';
const OUT = join(dirname(fileURLToPath(import.meta.url)), '.gemini-share-sniff.json');

// ---------- CDP helpers ----------
let msgId = 0;
const pending = new Map();
let ws;
const listeners = [];

function sendCmd(method, params = {}, sessionId) {
  return new Promise((resolve, reject) => {
    const id = ++msgId;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params, sessionId }));
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

async function connect() {
  const targets = await (await fetch(`${CDP_HTTP}/json/list`)).json();
  const page = await (
    await fetch(`${CDP_HTTP}/json/new?url=about:blank`, { method: 'PUT' })
  ).json();
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = rej;
  });
  ws.onmessage = (e) => onMessage(e.data);
  return page;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function evalJs(expression) {
  const res = await sendCmd('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (res.exceptionDetails) throw new Error(JSON.stringify(res.exceptionDetails).slice(0, 500));
  return res.result.value;
}

// ---------- capture store ----------
const captures = [];
const seen = new Map();

// Simpan semua request ke domain google (API internal) + media/audio
function keep(url, type, mime) {
  try {
    const u = new URL(url);
    if (u.protocol === 'data:' || u.protocol === 'blob:') return false;
    const host = u.hostname;
    // media & audio
    if (type === 'media') return true;
    if (/audio|tts|speech|voice/i.test(u.pathname)) return true;
    // API internal google
    if (/(batchexecute|StreamGenerate|lamda|assistant)/.test(u.pathname)) return true;
    if (host.endsWith('google.com') && (type === 'xhr' || type === 'fetch')) return true;
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
      requestHeaders: r.headers,
      postData: r.postData ? r.postData.slice(0, 8000) : null,
      ts: Date.now(),
    });
  }

  if (msg.method === 'Network.responseReceived') {
    const meta = seen.get(msg.params.requestId);
    if (!meta) return;
    meta.status = msg.params.response.status;
    meta.mimeType = msg.params.response.mimeType;
    meta.responseHeaders = msg.params.response.headers;
  }

  if (msg.method === 'Network.loadingFinished') {
    const meta = seen.get(msg.params.requestId);
    if (!meta) return;
    seen.delete(msg.params.requestId);
    // ambil body hanya utk teks/json; media besar skip
    const wantBody = /json|text|javascript/.test(meta.mimeType || '');
    if (!wantBody) {
      captures.push({ ...meta, responseBody: `<skip ${meta.mimeType}>` });
      console.log(`[+] ${meta.method} ${meta.status} [${meta.type}] ${(meta.mimeType||'').slice(0,30)} ${meta.url.slice(0, 110)}`);
      return;
    }
    sendCmd('Network.getResponseBody', { requestId: msg.params.requestId }, msg.sessionId)
      .then((body) => {
        meta.responseBody = body.base64Encoded
          ? Buffer.from(body.body, 'base64').toString('utf8').slice(0, 400000)
          : body.body.slice(0, 400000);
      })
      .catch((e) => {
        meta.responseBody = `<gagal: ${e.message}>`;
      })
      .finally(() => {
        captures.push(meta);
        console.log(`[+] ${meta.method} ${meta.status} [${meta.type}] ${meta.url.slice(0, 110)}`);
      });
  }
});

// ---------- main ----------
async function main() {
  console.log(`[i] konek ke ${CDP_HTTP} ...`);
  const page = await connect();

  await sendCmd('Network.enable');
  await sendCmd('Page.enable');
  await sendCmd('Runtime.enable');

  console.log(`[i] navigasi ke: ${SHARE_URL}`);
  await sendCmd('Page.navigate', { url: SHARE_URL });

  // tunggu load stabil
  for (let i = 0; i < 25; i++) {
    await sleep(1000);
    if (captures.some((c) => c.type === 'media' || /audio|tts|speech/i.test(c.url))) break;
  }
  await sleep(5000);

  // cari elemen tombol play audio di DOM
  const domInfo = await evalJs(`(() => {
    const btns = [...document.querySelectorAll('button, [role="button"], aria-label')]
      .map(b => ({ label: b.getAttribute('aria-label'), cls: (b.className||'').toString().slice(0,80) }))
      .filter(b => b.label && /listen|play|audio|suara|dengar|putar/i.test(b.label));
    const audios = [...document.querySelectorAll('audio, video, source')].map(a => ({
      tag: a.tagName, src: (a.src||a.getAttribute('src')||'').slice(0,300)
    }));
    return { playButtons: btns.slice(0,10), mediaElems: audios, title: document.title,
             hasConv: !!document.querySelector('model-response, message-content, .conversation-container') };
  })()`);
  console.log('[i] DOM:', JSON.stringify(domInfo, null, 2));

  // klik tombol play/listen jika ada (memicu fetch audio)
  if (domInfo.playButtons?.length) {
    console.log(`[i] klik tombol play: "${domInfo.playButtons[0].label}"`);
    await evalJs(`(() => {
      const btns = [...document.querySelectorAll('button, [role=\"button\"]')]
        .filter(b => /listen|play|audio|suara|dengar|putar/i.test(b.getAttribute('aria-label')||''));
      btns[0]?.click();
      return 'clicked';
    })()`);
    console.log('[i] menunggu 12s setelah klik play ...');
    await sleep(12000);
  }

  await sleep(3000);
  writeFileSync(OUT, JSON.stringify(captures, null, 2));
  console.log(`\n[i] total ${captures.length} request -> ${OUT}`);

  console.log('\n===== RINGKASAN MEDIA/API =====');
  for (const c of captures) {
    if (c.type === 'media' || /audio|tts|speech|voice/i.test(c.url)) {
      console.log(`${c.method} ${c.status} [${c.mimeType}] ${c.url}`);
    }
  }
  process.exit(0);
}

main().catch((e) => {
  console.error('[x]', e.message);
  process.exit(1);
});

#!/usr/bin/env node
/**
 * CDP Sniffer untuk gemini.google.com/app
 *
 * Usage:
 *   node scripts/sniff-gemini.mjs --status          # cek login & struktur DOM
 *   node scripts/sniff-gemini.mjs --send "hi"       # kirim pesan + rekam trafik API
 *   node scripts/sniff-gemini.mjs --models          # dump daftar model dari UI
 *   node scripts/sniff-gemini.mjs                   # sniff pasif SNIFF_MS ms
 */

import { writeFileSync, existsSync, readFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CDP_HTTP = process.env.CDP_URL || 'http://127.0.0.1:9222';
const TARGET = 'https://gemini.google.com/app';
const OUT = join(dirname(fileURLToPath(import.meta.url)), '.gemini-sniff.json');
const DURATION_MS = parseInt(process.env.SNIFF_MS || '45000', 10);

const args = process.argv.slice(2);
const sendIdx = args.indexOf('--send');
const SEND_TEXT = sendIdx !== -1 ? args[sendIdx + 1] : null;
const STATUS_ONLY = args.includes('--status');
const MODELS_ONLY = args.includes('--models');

// ---------- CDP helpers ----------
let msgId = 0;
const pending = new Map();
let ws;

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

const listeners = [];
function onEvent(fn) { listeners.push(fn); }

async function connect() {
  const targets = await (await fetch(`${CDP_HTTP}/json/list`)).json();
  let page = targets.find((t) => t.type === 'page' && t.url.includes('gemini.google.com'));
  if (!page) {
    page = await (
      await fetch(`${CDP_HTTP}/json/new?url=${encodeURIComponent(TARGET)}`, { method: 'PUT' })
    ).json();
  } else {
    await fetch(`http://127.0.0.1:9222/json/activate/${page.id}`).catch(() => {});
  }
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = rej;
  });
  ws.onmessage = (e) => onMessage(e.data);
  return page;
}

// ---------- capture store ----------
const captures = [];
const seenRequests = new Map();

function isApi(url) {
  try {
    const u = new URL(url);
    if (u.hostname !== 'gemini.google.com') return false;
    if (u.pathname.includes('/data/assistant.lamda')) return true;
    if (u.pathname.includes('batchexecute')) return true;
    return false;
  } catch { return false; }
}

onEvent(async (msg) => {
  if (msg.method === 'Network.requestWillBeSent') {
    const r = msg.params.request;
    if (!isApi(r.url)) return;
    seenRequests.set(msg.params.requestId, {
      url: r.url,
      method: r.method,
      requestHeaders: r.headers,
      postData: r.postData ? r.postData.slice(0, 60000) : null,
      ts: Date.now(),
    });
  }

  if (msg.method === 'Network.responseReceived') {
    const meta = seenRequests.get(msg.params.requestId);
    if (!meta) return;
    meta.status = msg.params.response.status;
    meta.responseHeaders = msg.params.response.headers;
  }

  if (msg.method === 'Network.loadingFinished') {
    const meta = seenRequests.get(msg.params.requestId);
    if (!meta) return;
    seenRequests.delete(msg.params.requestId);
    try {
      const body = await sendCmd('Network.getResponseBody', { requestId: msg.params.requestId }, msg.sessionId);
      meta.responseBody = body.base64Encoded
        ? Buffer.from(body.body, 'base64').toString('utf8').slice(0, 120000)
        : body.body.slice(0, 120000);
    } catch (e) {
      meta.responseBody = `<gagal ambil body: ${e.message}>`;
    }
    captures.push(meta);
    console.log(`[+] ${meta.method} ${meta.status} ${meta.url.slice(0, 100)}`);
  }
});

// ---------- helpers ----------
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function evalJs(expression) {
  const res = await sendCmd('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (res.exceptionDetails) throw new Error(JSON.stringify(res.exceptionDetails).slice(0, 300));
  return res.result.value;
}

/** Kirim pesan ke input Quill (.ql-editor contenteditable) lalu Enter */
async function sendMessage(text) {
  await evalJs(`(() => {
    const ed = document.querySelector('.ql-editor[contenteditable="true"], div[contenteditable="true"].ql-editor');
    if (!ed) return 'NO_EDITOR';
    ed.focus();
    document.execCommand('selectAll', false, null);
    document.execCommand('delete', false, null);
    document.execCommand('insertText', false, ${JSON.stringify(text)});
    return 'OK:' + ed.textContent.slice(0,50);
  })()`);
  await sleep(400);
  // klik tombol kirim
  return evalJs(`(() => {
    const btns = [...document.querySelectorAll('button')];
    const send = btns.find(b => b.querySelector('.send-button-container, [aria-label*="Send" i], [mattooltip*="Send" i]')) ||
                 btns.find(b => (b.getAttribute('aria-label')||'').match(/send/i));
    if (send && !send.disabled) { send.click(); return 'CLICKED'; }
    const ed = document.querySelector('.ql-editor');
    for (const type of ['keydown','keypress','keyup']) {
      ed.dispatchEvent(new KeyboardEvent(type,{key:'Enter',code:'Enter',keyCode:13,which:13,bubbles:true,cancelable:true}));
    }
    return 'ENTER_FALLBACK';
  })()`);
}

// ---------- main ----------
async function main() {
  console.log(`[i] konek ke ${CDP_HTTP} ...`);
  const page = await connect();
  console.log(`[i] target: ${page.url}`);

  await sendCmd('Network.enable');
  await sendCmd('Page.enable');
  await sendCmd('Runtime.enable');

  if (!page.url.includes('gemini.google.com')) {
    console.log('[i] navigasi ke gemini.google.com/app ...');
    await sendCmd('Page.navigate', { url: TARGET });
    await sleep(7000);
  }

  if (STATUS_ONLY) {
    const info = await evalJs(`(() => ({
      href: location.href,
      title: document.title,
      loggedIn: !document.body.innerText.match(/Sign in|Masuk/i),
      hasEditor: !!document.querySelector('.ql-editor'),
      editors: document.querySelectorAll('[contenteditable="true"]').length,
      bodyText: document.body.innerText.slice(0, 500),
    }))()`);
    console.log(JSON.stringify(info, null, 2));
    process.exit(0);
  }

  if (MODELS_ONLY) {
    const info = await evalJs(`(() => {
      // buka menu pemilih model bila ada
      const picker = document.querySelector('model-switcher, .model-switcher, [data-test-id="bard-mode-menu-button"], button[aria-label*="model" i]');
      return {
        pickerFound: !!picker,
        candidates: [...document.querySelectorAll('button,[role="menuitem"]')]
          .map(b => (b.textContent||'').trim())
          .filter(t => t && t.length < 40)
          .slice(0, 60),
      };
    })()`);
    console.log(JSON.stringify(info, null, 2));
    process.exit(0);
  }

  console.log(`[i] sniffing ${DURATION_MS / 1000}s ...`);

  if (SEND_TEXT) {
    const r = await sendMessage(SEND_TEXT);
    console.log(`[i] kirim pesan "${SEND_TEXT}" -> ${r}`);
  }

  await sleep(DURATION_MS);

  mkdirSync(dirname(OUT), { recursive: true });
  let prev = [];
  if (existsSync(OUT)) {
    try { prev = JSON.parse(readFileSync(OUT, 'utf8')); } catch {}
  }
  const merged = [...prev, ...captures];
  writeFileSync(OUT, JSON.stringify(merged, null, 2));
  console.log(`\n[i] total ${captures.length} API call baru (${merged.length} kumulatif) -> ${OUT}`);

  // simpan juga cookies utk client
  const cookies = await sendCmd('Network.getAllCookies');
  const gemCookies = cookies.cookies.filter((c) => c.domain.includes('google.com'));
  writeFileSync(join(dirname(OUT), '.gemini-cookies.json'), JSON.stringify(gemCookies, null, 2));
  console.log(`[i] ${gemCookies.length} cookie google.com -> scripts/.gemini-cookies.json`);
  process.exit(0);
}

main().catch((e) => {
  console.error('[x]', e.message);
  process.exit(1);
});

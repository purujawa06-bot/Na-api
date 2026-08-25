#!/usr/bin/env node
/**
 * CDP Sniffer untuk notegpt.io/ai-chat
 *
 * Usage:
 *   node scripts/sniff-notegpt.mjs --send "hi"   # kirim pesan + rekam trafik API
 *   node scripts/sniff-notegpt.mjs               # sniff pasif SNIFF_MS ms
 */

const CDP_HTTP = process.env.CDP_URL || 'http://127.0.0.1:9222';
const TARGET = 'https://notegpt.io/ai-chat';
const OUT = new URL('./.notegpt-sniff.json', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const DURATION_MS = parseInt(process.env.SNIFF_MS || '30000', 10);

const args = process.argv.slice(2);
const sendIdx = args.indexOf('--send');
const SEND_TEXT = sendIdx !== -1 ? args[sendIdx + 1] : null;

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
  let page = targets.find((t) => t.type === 'page' && t.url.includes('notegpt.io'));
  if (!page) {
    page = await (
      await fetch(`${CDP_HTTP}/json/new?url=${encodeURIComponent(TARGET)}`, { method: 'PUT' })
    ).json();
  } else {
    await fetch(`${CDP_HTTP}/json/activate/${page.id}`).catch(() => {});
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

function isInteresting(r, type) {
  const t = (type || '').toUpperCase();
  if (!['FETCH', 'XHR', 'EVENTSOURCE'].includes(t)) return false;
  try {
    const u = new URL(r.url);
    // buang telemetri umum
    if (/google-analytics|googletagmanager|sentry|clarity|facebook|doubleclick|adservice/.test(u.hostname)) return false;
    return true;
  } catch { return false; }
}

onEvent(async (msg) => {
  if (msg.method === 'Network.requestWillBeSent') {
    const r = msg.params.request;
    if (!isInteresting(r, msg.params.type)) return;
    seenRequests.set(msg.params.requestId, {
      url: r.url,
      method: r.method,
      type: msg.params.type,
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
    console.log(`[+] ${meta.method} ${meta.status} ${meta.url.slice(0, 110)}`);
  }
});

// ---------- helpers ----------
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function evalJs(expression) {
  const res = await sendCmd('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (res.exceptionDetails) throw new Error(JSON.stringify(res.exceptionDetails).slice(0, 300));
  return res.result.value;
}

/** Kirim pesan: cari textarea/contenteditable lalu Enter/klik kirim */
async function sendMessage(text) {
  await evalJs(`(() => {
    const ed = document.querySelector('textarea') || document.querySelector('[contenteditable="true"]');
    if (!ed) return 'NO_EDITOR';
    ed.focus();
    if (ed.tagName === 'TEXTAREA') {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
      setter.call(ed, ${JSON.stringify(text)});
      ed.dispatchEvent(new Event('input', { bubbles: true }));
    } else {
      document.execCommand('insertText', false, ${JSON.stringify(text)});
    }
    return 'OK:' + (ed.value || ed.textContent || '').slice(0, 50);
  })()`);
  await sleep(500);
  return evalJs(`(() => {
    const btns = [...document.querySelectorAll('button')];
    const send = btns.find(b => {
      const label = ((b.getAttribute('aria-label') || '') + ' ' + (b.className || '')).toLowerCase();
      const svg = !!b.querySelector('svg');
      return !b.disabled && (label.includes('send') || (svg && b.closest('form,.input-area,[class*="chat"]')));
    });
    if (send) { send.click(); return 'CLICKED'; }
    const ed = document.querySelector('textarea') || document.querySelector('[contenteditable="true"]');
    if (!ed) return 'NO_EDITOR_2';
    for (const type of ['keydown', 'keypress', 'keyup']) {
      ed.dispatchEvent(new KeyboardEvent(type, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }));
    }
    return 'ENTER_FALLBACK';
  })()`);
}

// ---------- main ----------
import { writeFileSync, readFileSync } from 'node:fs';

async function main() {
  console.log(`[i] konek ke ${CDP_HTTP} ...`);
  const page = await connect();
  console.log(`[i] target: ${page.url}`);

  await sendCmd('Network.enable');
  await sendCmd('Page.enable');
  await sendCmd('Runtime.enable');

  if (!page.url.includes('notegpt.io')) {
    console.log('[i] navigasi ke notegpt.io/ai-chat ...');
    await sendCmd('Page.navigate', { url: TARGET });
    await sleep(9000);
  }

  console.log(`[i] sniffing ${DURATION_MS / 1000}s ...`);

  if (SEND_TEXT) {
    const r = await sendMessage(SEND_TEXT);
    console.log(`[i] kirim pesan "${SEND_TEXT}" -> ${r}`);
  }

  await sleep(DURATION_MS);

  let prev = [];
  try { prev = JSON.parse(readFileSync(OUT, 'utf8')); } catch {}
  const merged = [...prev, ...captures];
  writeFileSync(OUT, JSON.stringify(merged, null, 2));
  console.log(`\n[i] total ${captures.length} API call baru (${merged.length} kumulatif) -> ${OUT}`);
  process.exit(0);
}

main().catch((e) => {
  console.error('[x]', e.message);
  process.exit(1);
});

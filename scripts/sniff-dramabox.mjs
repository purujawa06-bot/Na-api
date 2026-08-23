#!/usr/bin/env node
/**
 * CDP Sniffer untuk dramabox.com — reverse engineering API Dramabox
 *
 * Usage:
 *   node scripts/sniff-dramabox.mjs [URL]
 *   env DB_URL=... node scripts/sniff-dramabox.mjs
 */

import { writeFileSync, existsSync, readFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CDP_HTTP = process.env.CDP_URL || 'http://127.0.0.1:9222';
const DB_URL = process.env.DB_URL || process.argv[2] || 'https://www.dramabox.com/in';
const OUT = join(dirname(fileURLToPath(import.meta.url)), '.dramabox-sniff.json');
const MAIN_DOMAIN = 'dramabox.com';

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
  let page = targets.find((t) => t.type === 'page');
  if (!page) {
    page = await (await fetch(`${CDP_HTTP}/json/new?url=about:blank`, { method: 'PUT' })).json();
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

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function evalJs(expression) {
  const res = await sendCmd('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (res.exceptionDetails) throw new Error(JSON.stringify(res.exceptionDetails).slice(0, 300));
  return res.result.value;
}

// ---------- capture store ----------
const captures = [];
const seen = new Map();

function keep(url, method, postData, type) {
  try {
    const u = new URL(url);
    if (u.protocol === 'data:' || u.protocol === 'blob:') return false;
    const host = u.hostname;
    const isDbHost = host === MAIN_DOMAIN || host.endsWith('.' + MAIN_DOMAIN) || host === 'api.' + MAIN_DOMAIN;
    if (isDbHost) return true;
    if (type === 'xhr' || type === 'fetch') return true;
    if (method !== 'GET') return true;
    return false;
  } catch {
    return false;
  }
}

onEvent((msg) => {
  if (msg.method === 'Network.requestWillBeSent') {
    const r = msg.params.request;
    const rt = msg.params.type || '';
    if (!keep(r.url, r.method, r.postData, rt)) return;
    seen.set(msg.params.requestId, {
      url: r.url,
      method: r.method,
      type: rt,
      requestHeaders: r.headers,
      postData: r.postData ? r.postData.slice(0, 20000) : null,
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
    const wantBody = meta.type === 'xhr' || meta.type === 'fetch' || (meta.mimeType || '').includes('json');
    if (!wantBody) {
      captures.push(meta);
      console.log(`[+] ${meta.method} ${meta.status} ${meta.type} ${meta.url.slice(0, 110)}`);
      return;
    }
    sendCmd('Network.getResponseBody', { requestId: msg.params.requestId }, msg.sessionId)
      .then((body) => {
        meta.responseBody = body.base64Encoded
          ? Buffer.from(body.body, 'base64').toString('utf8').slice(0, 200000)
          : body.body.slice(0, 200000);
      })
      .catch((e) => {
        meta.responseBody = `<gagal: ${e.message}>`;
      })
      .finally(() => {
        captures.push(meta);
        console.log(`[+] ${meta.method} ${meta.status} ${meta.type} ${meta.url.slice(0, 110)}`);
      });
  }
});

// ---------- main ----------
async function main() {
  console.log(`[i] konek ke ${CDP_HTTP} ...`);
  const page = await connect();
  console.log(`[i] tab: ${page.url}`);

  await sendCmd('Network.enable');
  await sendCmd('Page.enable');
  await sendCmd('Runtime.enable');

  console.log(`[i] navigasi ke ${DB_URL} ...`);
  await sendCmd('Page.navigate', { url: DB_URL });
  await sleep(10000);

  const info = await evalJs(`(() => ({
    href: location.href,
    title: document.title,
    cards: document.querySelectorAll('a[href*="/drama/"], [class*="drama"]').length,
  }))()`);
  console.log(JSON.stringify(info, null, 2));

  console.log('[i] scroll perlahan untuk trigger lazy load ...');
  for (let i = 0; i < 8; i++) {
    await evalJs(`window.scrollBy(0, window.innerHeight * 0.9)`);
    await sleep(1500);
  }
  await sleep(3000);

  const after = await evalJs(`(() => ({
    href: location.href,
    title: document.title,
    bodyText: document.body.innerText.slice(0, 500),
  }))()`);
  console.log('[i] SETELAH SCROLL:');
  console.log(JSON.stringify(after, null, 2));

  mkdirSync(dirname(OUT), { recursive: true });
  let prev = [];
  if (existsSync(OUT)) {
    try {
      prev = JSON.parse(readFileSync(OUT, 'utf8'));
    } catch {}
  }
  const merged = [...prev, ...captures];
  writeFileSync(OUT, JSON.stringify(merged, null, 2));
  console.log(`\n[i] total ${captures.length} request baru (${merged.length} kumulatif) -> ${OUT}`);
  process.exit(0);
}

main().catch((e) => {
  console.error('[x]', e.message);
  process.exit(1);
});

#!/usr/bin/env node
/**
 * CDP Sniffer dramabox: (1) halaman detail + play episode, (2) pencarian.
 * Usage: node scripts/sniff-dramabox-flow.mjs
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CDP_HTTP = process.env.CDP_URL || 'http://127.0.0.1:9222';
const DETAIL_URL = process.env.DB_DETAIL_URL || 'https://www.dramabox.com/in/drama/41000105764/Cinta-Membara-di-Dalam-Kebohongan';
const SEARCH_KEYWORD = process.env.DB_SEARCH || 'cinta';
const OUT = join(dirname(fileURLToPath(import.meta.url)), '.dramabox-flow-sniff.json');

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

const captures = [];
const seen = new Map();

function keep(url, method, postData, type) {
  try {
    const u = new URL(url);
    if (u.protocol === 'data:' || u.protocol === 'blob:') return false;
    const host = u.hostname;
    if (['dramabox.com', 'dramaboxdb.com'].some((h) => host === h || host.endsWith('.' + h))) return true;
    if (type === 'xhr' || type === 'fetch') return true;
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
    const wantBody = meta.type === 'xhr' || meta.type === 'fetch' || (meta.mimeType || '').includes('json');
    if (!wantBody) {
      captures.push(meta);
      console.log(`[+] ${meta.method} ${meta.status} ${meta.type} ${meta.url.slice(0, 130)}`);
      return;
    }
    sendCmd('Network.getResponseBody', { requestId: msg.params.requestId }, msg.sessionId)
      .then((body) => {
        meta.responseBody = body.base64Encoded
          ? Buffer.from(body.body, 'base64').toString('utf8').slice(0, 300000)
          : body.body.slice(0, 300000);
      })
      .catch((e) => {
        meta.responseBody = `<gagal: ${e.message}>`;
      })
      .finally(() => {
        captures.push(meta);
        console.log(`[+] ${meta.method} ${meta.status} ${meta.type} ${meta.url.slice(0, 130)}`);
      });
  }
});

async function main() {
  console.log(`[i] konek ke ${CDP_HTTP} ...`);
  await connect();
  await sendCmd('Network.enable');
  await sendCmd('Page.enable');
  await sendCmd('Runtime.enable');

  // ---- Phase 1: detail + play ----
  console.log(`[i] buka detail: ${DETAIL_URL}`);
  await sendCmd('Page.navigate', { url: DETAIL_URL });
  await sleep(9000);

  const info1 = await evalJs(`(() => ({
    title: document.title,
    hasPlay: !!document.querySelector('[class*="playBtn"],[class*="playBtnWrap"],[class*="play"],button'),
  }))()`);
  console.log('[i] detail DOM:', JSON.stringify(info1));

  const playCandidates = await evalJs(`(() => {
    const sel = '[class*="play"],[class*="Play"],button,[data-role]';
    const els = [...document.querySelectorAll(sel)].slice(0, 15).map(el => ({
      tag: el.tagName, cls: (el.className||'').toString().slice(0,60), text: (el.textContent||'').trim().slice(0,30),
    }));
    return els;
  })()`);
  console.log('[i] kandidat elemen play:', JSON.stringify(playCandidates, null, 2));

  const clicked = await evalJs(`(() => {
    const btn = document.querySelector('[class*="playBtn"]') || document.querySelector('[class*="firstPlay"]') || document.querySelector('[class*="play"]') || document.querySelector('button');
    if (!btn) return 'NO_PLAY_BTN';
    btn.click();
    return 'CLICKED: ' + (btn.className||'').toString().slice(0,60);
  })()`);
  console.log('[i]', clicked);

  console.log('[i] tunggu video 12s ...');
  await sleep(12000);

  const videoInfo = await evalJs(`(() => {
    const v = document.querySelector('video');
    return v ? { src: (v.currentSrc||v.src||'').slice(0,300), duration: v.duration, paused: v.paused } : null;
  })()`);
  console.log('[i] VIDEO:', JSON.stringify(videoInfo));

  // ---- Phase 2: search ----
  console.log(`[i] cari: ${SEARCH_KEYWORD}`);
  await sendCmd('Page.navigate', { url: 'https://www.dramabox.com/in' });
  await sleep(6000);

  const typed = await evalJs(`(() => {
    const inp = document.querySelector('input[type="search"]') || document.querySelector('input[placeholder]');
    if (!inp) return 'NO_INPUT';
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(inp, ${JSON.stringify(SEARCH_KEYWORD)});
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    inp.dispatchEvent(new Event('change', { bubbles: true }));
    inp.focus();
    const evt = new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true });
    inp.dispatchEvent(evt);
    const evt2 = new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true });
    inp.dispatchEvent(evt2);
    return inp.value;
  })()`);
  console.log('[i] input diisi:', JSON.stringify(typed));

  console.log('[i] tunggu hasil pencarian 10s ...');
  await sleep(10000);

  const searchState = await evalJs(`(() => ({
    href: location.href,
    title: document.title,
    cards: document.querySelectorAll('a[href*="/drama/"]').length,
  }))()`);
  console.log('[i] SEARCH STATE:', JSON.stringify(searchState));

  await sleep(3000);

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(captures, null, 2));
  console.log(`\n[i] total ${captures.length} request -> ${OUT}`);
  process.exit(0);
}

main().catch((e) => {
  console.error('[x]', e.message);
  process.exit(1);
});

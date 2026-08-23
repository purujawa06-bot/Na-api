#!/usr/bin/env node
/**
 * CDP Sniffer untuk ssstik.io — reverse engineering API downloader TikTok
 *
 * Usage:
 *   node scripts/sniff-ssstik.mjs [URL_TIKTOK]
 *   env TT_URL=... node scripts/sniff-ssstik.mjs
 */

import { writeFileSync, existsSync, readFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CDP_HTTP = process.env.CDP_URL || 'http://127.0.0.1:9222';
const TIKTOK_URL =
  process.env.TT_URL ||
  process.argv[2] ||
  'https://www.tiktok.com/@agungdarmawn_/video/7374017020418870534';
const OUT = join(dirname(fileURLToPath(import.meta.url)), '.ssstik-sniff.json');

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

function keep(url, method, postData) {
  try {
    const u = new URL(url);
    if (u.protocol === 'data:' || u.protocol === 'blob:') return false;
    const host = u.hostname;
    if (['ssstik.io'].some((h) => host === h || host.endsWith('.' + h))) return true;
    if (postData) return true;
    if (['xhr', 'fetch'].includes(arguments[3])) return true;
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
    meta.responseHeaders = msg.params.response.headers;
  }

  if (msg.method === 'Network.loadingFinished') {
    const meta = seen.get(msg.params.requestId);
    if (!meta) return;
    seen.delete(msg.params.requestId);
    sendCmd('Network.getResponseBody', { requestId: msg.params.requestId }, msg.sessionId)
      .then((body) => {
        meta.responseBody = body.base64Encoded
          ? Buffer.from(body.body, 'base64').toString('utf8').slice(0, 150000)
          : body.body.slice(0, 150000);
      })
      .catch((e) => {
        meta.responseBody = `<gagal: ${e.message}>`;
      })
      .finally(() => {
        captures.push(meta);
        console.log(`[+] ${meta.method} ${meta.status} ${meta.url.slice(0, 110)}`);
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

  console.log('[i] navigasi ke https://ssstik.io/id ...');
  await sendCmd('Page.navigate', { url: 'https://ssstik.io/id' });
  await sleep(6000);

  const info = await evalJs(`(() => ({
    href: location.href,
    title: document.title,
    hasInput: !!document.querySelector('#main_page_text'),
    hasSubmit: !!document.querySelector('#submit'),
    inputs: [...document.querySelectorAll('input')].map(i => ({id:i.id, name:i.name, type:i.type, placeholder:i.placeholder})),
  }))()`);
  console.log(JSON.stringify(info, null, 2));

  if (!info.hasInput) {
    console.error('[x] input tidak ditemukan, dump HTML fragment:');
    console.log((await evalJs(`document.body.innerHTML.slice(0, 2000)`)).slice(0, 2000));
    process.exit(1);
  }

  console.log(`[i] isi URL: ${TIKTOK_URL}`);
  await evalJs(`(() => {
    const inp = document.querySelector('#main_page_text');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(inp, ${JSON.stringify(TIKTOK_URL)});
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    inp.dispatchEvent(new Event('change', { bubbles: true }));
    return inp.value;
  })()`);

  console.log('[i] klik tombol download ...');
  const clicked = await evalJs(`(() => {
    const btn = document.querySelector('#submit') || document.querySelector('button[type="submit"]');
    if (!btn) return 'NO_BUTTON';
    btn.click();
    return 'CLICKED';
  })()`);
  console.log(`[i] ${clicked}`);

  console.log('[i] menunggu hasil 15s ...');
  await sleep(15000);

  const result = await evalJs(`(() => {
    const links = [...document.querySelectorAll('a')]
      .map(a => ({ href: a.href, text: (a.textContent||'').trim().slice(0,60), cls: a.className }))
      .filter(a => a.href && (a.href.includes('.mp4') || a.href.includes('tiktok') || a.href.includes('/download')))
      .slice(0, 10);
    const imgs = [...document.querySelectorAll('img')]
      .map(i => ({ src: i.currentSrc || i.src, alt: i.alt }))
      .filter(i => i.src && !i.src.startsWith('data:'))
      .slice(0, 6);
    return {
      hasResult: !!document.querySelector('.result_overlay, #result, .video-data'),
      links,
      imgs,
      bodySample: document.body.innerText.slice(0, 400),
    };
  })()`);
  console.log('[i] RESULT DOM:');
  console.log(JSON.stringify(result, null, 2));

  await sleep(3000);

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

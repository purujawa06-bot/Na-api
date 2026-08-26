#!/usr/bin/env node
/**
 * CDP Sniffer untuk soundcloud.com/search — reverse engineering API pencarian
 *
 * Usage:
 *   node scripts/sniff-soundcloud-search.mjs [QUERY]
 *   env SC_QUERY="lofi hip hop" node scripts/sniff-soundcloud-search.mjs
 */

import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CDP_HTTP = process.env.CDP_URL || 'http://127.0.0.1:9222';
const QUERY = process.env.SC_QUERY || process.argv[2] || 'winter night lofi';
const OUT = join(dirname(fileURLToPath(import.meta.url)), '.soundcloud-sniff.json');

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
  // buka tab baru khusus agar tidak mengganggu tab lain
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

// hanya simpan request yang relevan: api.soundcloud / api-v2 / sndcdn XHR
function keep(url, type) {
  try {
    const u = new URL(url);
    if (u.protocol === 'data:' || u.protocol === 'blob:') return false;
    const host = u.hostname;
    if (/^(api-v2|api)\.soundcloud\.com$/.test(host)) return true;
    if (type === 'xhr' || type === 'fetch') {
      if (host.endsWith('.sndcdn.com') && !host.startsWith('cf-media')) return true; // config/assets
      return host.includes('soundcloud');
    }
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
      postData: r.postData ? r.postData.slice(0, 5000) : null,
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
          ? Buffer.from(body.body, 'base64').toString('utf8').slice(0, 300000)
          : body.body.slice(0, 300000);
      })
      .catch((e) => {
        meta.responseBody = `<gagal: ${e.message}>`;
      })
      .finally(() => {
        captures.push(meta);
        console.log(`[+] ${meta.method} ${meta.status} ${meta.url.slice(0, 120)}`);
      });
  }
});

// ---------- main ----------
async function main() {
  console.log(`[i] konek ke ${CDP_HTTP} ...`);
  const page = await connect();
  console.log(`[i] tab baru: ${page.id}`);

  await sendCmd('Network.enable');
  await sendCmd('Page.enable');

  const searchUrl = `https://soundcloud.com/search?q=${encodeURIComponent(QUERY)}`;
  console.log(`[i] navigasi ke: ${searchUrl}`);
  await sendCmd('Page.navigate', { url: searchUrl });

  // tunggu request API pertama muncul
  for (let i = 0; i < 30; i++) {
    await sleep(1000);
    if (captures.some((c) => c.url.includes('/search'))) break;
  }
  console.log('[i] menunggu hasil stabil 8s ...');
  await sleep(8000);

  // scroll untuk memicu paginasi (offset berikutnya)
  console.log('[i] scroll ke bawah utk picu load-more ...');
  await evalJs(`window.scrollTo(0, document.body.scrollHeight)`);
  await sleep(6000);

  const info = await evalJs(`(() => ({
    href: location.href,
    title: document.title,
    resultCount: document.querySelectorAll('ul.soundList li, .searchList__item').length,
    sample: [...document.querySelectorAll('.soundTitle__title')].slice(0,5).map(e => e.textContent.trim()),
  }))()`);
  console.log('[i] DOM:', JSON.stringify(info, null, 2));

  await sleep(3000);

  writeFileSync(OUT, JSON.stringify(captures, null, 2));
  console.log(`\n[i] total ${captures.length} request -> ${OUT}`);

  // ringkas endpoint API yang tertangkap
  const apiCalls = captures.filter((c) => c.url.includes('api-v2.soundcloud.com'));
  console.log('\n===== RINGKASAN API =====');
  for (const c of apiCalls) {
    const u = new URL(c.url);
    console.log(`${c.method} ${u.pathname} status=${c.status}`);
    const params = {};
    u.searchParams.forEach((v, k) => (params[k] = v.length > 60 ? v.slice(0, 57) + '...' : v));
    console.log('   params:', JSON.stringify(params));
  }
  process.exit(0);
}

main().catch((e) => {
  console.error('[x]', e.message);
  process.exit(1);
});

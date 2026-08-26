#!/usr/bin/env node
/**
 * Monitor 90 detik di tab share a1e651123774 — REKAM SEMUA request
 * (tanpa filter, termasuk media & websocket). User klik Listen MANUAL.
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CDP_HTTP = process.env.CDP_URL || 'http://127.0.0.1:9222';
const OUT = join(dirname(fileURLToPath(import.meta.url)), '.manual-listen-capture.json');

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
    msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
  }
  listeners.forEach((fn) => fn(msg));
}
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function main() {
  const targets = await (await fetch(`${CDP_HTTP}/json/list`)).json();
  let page = targets.find((t) => t.type === 'page' && t.url.includes('a1e651123774'));
  if (!page) page = targets.find((t) => t.type === 'page' && t.url.includes('gemini.google.com'));
  if (!page) throw new Error('tidak ada tab gemini');
  console.log('[i] monitor tab:', page.url.slice(0, 80));
  console.log('>>> KLIK TOMBOL LISTEN SEKARANG (manual pakai mouse)! <<<');

  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => onMessage(e.data);

  await sendCmd('Network.enable');

  const reqs = [];
  const seen = new Map();
  listeners.push((msg) => {
    if (msg.method === 'Network.requestWillBeSent') {
      const r = msg.params.request;
      try { if (new URL(r.url).protocol === 'data:') return; } catch { return; }
      const rec = {
        t: new Date().toISOString().slice(11, 19),
        method: r.method,
        url: r.url,
        type: msg.params.type || '',
        postData: r.postData ? r.postData.slice(0, 20000) : null,
      };
      reqs.push(rec);
      // log singkat utk non-statis
      if (!/\.(js|css|png|jpg|svg|woff|ico)(\?|$)/.test(r.url)) {
        console.log(`[${rec.t}] ${r.method} [${rec.type}] ${r.url.slice(0, 120)}`);
      }
      seen.set(msg.params.requestId, rec);
    }
    if (msg.method === 'Network.responseReceived') {
      const rec = seen.get(msg.params.requestId);
      if (rec) { rec.status = msg.params.response.status; rec.respMime = msg.params.response.mimeType; }
    }
    if (msg.method === 'Network.loadingFinished') {
      const rec = seen.get(msg.params.requestId);
      if (!rec || rec.bodyFetched) return;
      rec.bodyFetched = true;
      sendCmd('Network.getResponseBody', { requestId: msg.params.requestId })
        .then((b) => { rec.respBody = b.base64Encoded ? Buffer.from(b.body,'base64').toString('utf8').slice(0,800000) : String(b.body).slice(0,800000); })
        .catch(() => {});
    }
    if (msg.method === 'Network.webSocketCreated') {
      reqs.push({ t: new Date().toISOString().slice(11,19), ws: msg.params.url });
      console.log(`[WS] ${msg.params.url.slice(0,150)}`);
    }
  });

  await sleep(90000);
  writeFileSync(OUT, JSON.stringify(reqs, null, 1));
  console.log(`\n[i] total ${reqs.length} request -> ${OUT}`);
  process.exit(0);
}
main().catch((e) => { console.error('[x]', e.message); process.exit(1); });

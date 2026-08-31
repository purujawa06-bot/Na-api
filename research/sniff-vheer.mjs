#!/usr/bin/env node
/**
 * CDP Sniffer untuk vheer.com/app/text-to-image
 *
 * Merekam semua trafik dari tab vheer.com (headers, payload, cookies,
 * response body) ke research/.vheer-sniff.json
 *
 * Usage:
 *   node research/sniff-vheer.mjs            # sniff 120 detik default
 *   node research/sniff-vheer.mjs --ms 300000
 */

import { writeFileSync, existsSync, readFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CDP_HTTP = process.env.CDP_URL || 'http://127.0.0.1:9222';
const TARGET = 'https://vheer.com/app/text-to-image';
const OUT = join(dirname(fileURLToPath(import.meta.url)), '.vheer-sniff.json');
const args = process.argv.slice(2);
const msIdx = args.indexOf('--ms');
const DURATION_MS = msIdx !== -1 ? parseInt(args[msIdx + 1], 10) : 120000;

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
  let page = targets.find(
    (t) => t.type === 'page' && t.url.includes('vheer.com')
  );
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

const captures = [];
const seenRequests = new Map();
const seenResponses = new Set();

function isApi(url) {
  try {
    const u = new URL(url);
    if (u.hostname.endsWith('vheer.com')) return true;
    if (u.hostname.endsWith('vheer.com') === false && /(api|gateway|vheer)/i.test(u.hostname + u.pathname)) return true;
    // tangkap juga host pihak-3 yang relevan (cloud storage, worker)
    if (/vheer|text2image|text-to-image|tts|worker/i.test(u.hostname)) return true;
    return false;
  } catch { return false; }
}

onEvent(async (msg) => {
  if (msg.method === 'Network.requestWillBeSent') {
    const r = msg.params.request;
    if (r.url.includes('.png') || r.url.includes('.jpg') || r.url.includes('.webp') || r.url.includes('.gif') || r.url.includes('.js') || r.url.includes('.css') || r.url.includes('.woff')) return;
    if (!isApi(r.url)) return;
    seenRequests.set(msg.params.requestId, {
      url: r.url,
      method: r.method,
      requestHeaders: r.headers,
      postData: r.postData || null,
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
      const body = await sendCmd('Network.getResponseBody', {
        requestId: msg.params.requestId,
      }, msg.sessionId);
      meta.responseBody = body.base64Encoded
        ? Buffer.from(body.body, 'base64').toString('utf8').slice(0, 200000)
        : body.body.slice(0, 200000);
    } catch (e) {
      meta.responseBody = `<gagal ambil body: ${e.message}>`;
    }
    captures.push(meta);
    console.log(`[+] ${meta.method} ${meta.status} ${meta.url.slice(0, 120)}`);
  }
});

async function main() {
  console.log(`[i] konek ke ${CDP_HTTP} ...`);
  const page = await connect();
  console.log(`[i] target: ${page.url}`);

  await sendCmd('Network.enable');
  await sendCmd('Page.enable');

  if (!page.url.includes('vheer.com')) {
    console.log('[i] navigasi ke vheer.com ...');
    await sendCmd('Page.navigate', { url: TARGET });
  }

  console.log(`[i] sniffing ${DURATION_MS / 1000}s ... (interaksi manual di browser juga terekam)`);

  await new Promise((r) => setTimeout(r, DURATION_MS));

  mkdirSync(dirname(OUT), { recursive: true });
  let prev = [];
  if (existsSync(OUT)) {
    try { prev = JSON.parse(readFileSync(OUT, 'utf8')); } catch {}
  }
  const merged = [...prev, ...captures];
  writeFileSync(OUT, JSON.stringify(merged, null, 2));
  console.log(`\n[i] total ${captures.length} call baru (${merged.length} kumulatif) -> ${OUT}`);
  process.exit(0);
}

main().catch((e) => {
  console.error('[x]', e.message);
  process.exit(1);
});

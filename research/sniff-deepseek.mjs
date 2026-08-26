#!/usr/bin/env node
/**
 * CDP Sniffer untuk chat.deepseek.com
 *
 * Membuka tab chat.deepseek.com di Brave (CDP port 9222),
 * merekam semua trafik /api/* beserta headers, payload, cookies,
 * dan response body ke scripts/.deepseek-sniff.json
 *
 * Usage:
 *   node scripts/sniff-deepseek.mjs              # sniff 60 detik
 *   node scripts/sniff-deepseek.mjs --send "hi"  # auto-kirim pesan via UI
 *   node scripts/sniff-deepseek.mjs --status     # cek login status
 */

import { writeFileSync, existsSync, readFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CDP_HTTP = process.env.CDP_URL || 'http://127.0.0.1:9222';
const TARGET = 'https://chat.deepseek.com/';
const OUT = join(dirname(fileURLToPath(import.meta.url)), '.deepseek-sniff.json');
const DURATION_MS = parseInt(process.env.SNIFF_MS || '60000', 10);

const args = process.argv.slice(2);
const sendIdx = args.indexOf('--send');
const SEND_TEXT = sendIdx !== -1 ? args[sendIdx + 1] : null;
const STATUS_ONLY = args.includes('--status');
const NEW_CHAT = args.includes('--newchat');

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
  let page = targets.find(
    (t) => t.type === 'page' && t.url.includes('chat.deepseek.com')
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

// ---------- capture store ----------
const captures = []; // api requests
const seenRequests = new Map(); // requestId -> meta

function isApi(url) {
  try {
    const u = new URL(url);
    if (u.hostname === 'chat.deepseek.com' && u.pathname.startsWith('/api/')) return true;
    if (u.hostname.endsWith('deepseek.com') && u.pathname.includes('completion')) return true;
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
        ? Buffer.from(body.body, 'base64').toString('utf8')
        : body.body;
    } catch (e) {
      meta.responseBody = `<gagal ambil body: ${e.message}>`;
    }
    captures.push(meta);
    console.log(`[+] ${meta.method} ${meta.status} ${meta.url.slice(0, 90)}`);
  }
});

// ---------- main ----------
async function main() {
  console.log(`[i] konek ke ${CDP_HTTP} ...`);
  const page = await connect();
  console.log(`[i] target: ${page.url}`);

  await sendCmd('Network.enable');
  await sendCmd('Page.enable');
  await sendCmd('Runtime.enable');

  // pastikan selalu di chat.deepseek.com
  if (!page.url.includes('chat.deepseek.com')) {
    console.log('[i] navigasi ke chat.deepseek.com ...');
    await sendCmd('Page.navigate', { url: TARGET });
  }

  if (STATUS_ONLY) {
    // tunggu DOM siap
    await sleep(6000);
    // dump localStorage userToken & profile info
    const res = await sendCmd('Runtime.evaluate', {
      expression: `(() => ({
          href: location.href,
          userToken: !!localStorage.getItem('userToken'),
          tokenPreview: (localStorage.getItem('userToken')||'').slice(0,25)+'...',
          title: document.title,
          hasTextarea: !!document.querySelector('textarea'),
          bodyText: document.body.innerText.slice(0, 400),
        }))()`,
      returnByValue: true,
    });
    console.log(JSON.stringify(res.result.value, null, 2));
    process.exit(0);
  }

  console.log(`[i] sniffing ${DURATION_MS / 1000}s ... (interaksi manual di browser juga terekam)`);

  if (SEND_TEXT) {
    if (NEW_CHAT) {
      console.log('[i] buka chat baru ...');
      await sendCmd('Page.navigate', { url: 'https://chat.deepseek.com/sign_in' === TARGET ? TARGET : 'https://chat.deepseek.com/' });
      await sleep(5000);
    }
    await sendCmd('Runtime.evaluate', {
      expression: `document.querySelector('#chat-input, textarea')?.focus()`,
    });
    await sendMessage(page.id, SEND_TEXT);
    console.log(`[i] pesan dikirim otomatis: "${SEND_TEXT}"`);
  }

  await sleep(DURATION_MS);

  mkdirSync(dirname(OUT), { recursive: true });

  // merge dengan capture sebelumnya kalau ada
  let prev = [];
  if (existsSync(OUT)) {
    try { prev = JSON.parse(readFileSync(OUT, 'utf8')); } catch {}
  }
  const merged = [...prev, ...captures];
  writeFileSync(OUT, JSON.stringify(merged, null, 2));
  console.log(`\n[i] total ${captures.length} API call baru (${merged.length} kumulatif) -> ${OUT}`);
  process.exit(0);
}

async function sendMessage(targetId, text) {
  // isi textarea lewat native setter (React-aware) lalu Enter sintetis
  await sendCmd('Runtime.evaluate', {
    expression: `(() => {
      const ta = document.querySelector('#chat-input, textarea');
      const set = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value').set;
      ta.focus(); set.call(ta, '');
      ta.dispatchEvent(new Event('input',{bubbles:true}));
      set.call(ta, ${JSON.stringify(text)});
      ta.dispatchEvent(new Event('input',{bubbles:true}));
      for (const type of ['keydown','keypress','keyup']) {
        ta.dispatchEvent(new KeyboardEvent(type,{key:'Enter',code:'Enter',keyCode:13,which:13,bubbles:true,cancelable:true}));
      }
      return 'ok';
    })()`,
    returnByValue: true,
  });
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

main().catch((e) => {
  console.error('[x]', e.message);
  process.exit(1);
});

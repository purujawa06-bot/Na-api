#!/usr/bin/env node
/**
 * Satu sesi: pasang listener network -> buka menu "Show more options" ->
 * klik paksa tombol "Listen" -> tangkap request batchexecute/media.
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CDP_HTTP = process.env.CDP_URL || 'http://127.0.0.1:9222';
const OUT = join(dirname(fileURLToPath(import.meta.url)), '.gemini-listen-sniff.json');

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
async function evalJs(expression) {
  const res = await sendCmd('Runtime.evaluate', { expression, returnByValue: true });
  if (res.exceptionDetails) throw new Error(JSON.stringify(res.exceptionDetails).slice(0, 400));
  return res.result.value;
}

async function main() {
  const targets = await (await fetch(`${CDP_HTTP}/json/list`)).json();
  const page = targets.find((t) => t.type === 'page' && t.url.includes('gemini.google.com/app'));
  if (!page) throw new Error('tidak ada tab gemini /app');
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => onMessage(e.data);

  await sendCmd('Network.enable');
  await sendCmd('Runtime.enable');

  const captures = [];
  const seen = new Map();
  listeners.push((msg) => {
    if (msg.method === 'Network.requestWillBeSent') {
      const r = msg.params.request;
      const rt = msg.params.type || '';
      let keep = false;
      try {
        const u = new URL(r.url);
        keep = /batchexecute/.test(u.pathname) || rt === 'media' || /audio|tts|speech|voice/i.test(u.pathname);
      } catch {}
      if (!keep) return;
      seen.set(msg.params.requestId, {
        url: r.url.slice(0, 2000), method: r.method, type: rt,
        postData: r.postData ? r.postData.slice(0, 20000) : null, ts: Date.now(),
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
      sendCmd('Network.getResponseBody', { requestId: msg.params.requestId })
        .then((b) => { meta.responseBody = b.base64Encoded ? Buffer.from(b.body,'base64').toString('utf8').slice(0,600000) : String(b.body).slice(0,600000); })
        .catch(() => {})
        .finally(() => {
          captures.push(meta);
          console.log(`[+] ${meta.method} ${meta.status} [${meta.type}] ${meta.url.slice(0,110)}`);
        });
    }
  });

  // buka menu more-options pada respons model terakhir
  console.log('[i] buka menu ...');
  await evalJs(`(() => {
    const btns=[...document.querySelectorAll('button')].filter(b=>/show more options/i.test(b.getAttribute('aria-label')||''));
    btns[btns.length-1]?.click();
    return true;
  })()`);
  await sleep(1500);

  // klik paksa Listen
  console.log('[i] klik Listen ...');
  await evalJs(`(() => {
    const b=[...document.querySelectorAll('button')].filter(x=>/^listen$/i.test((x.getAttribute('aria-label')||'').trim())).pop();
    if(!b) return false;
    ['pointerdown','mousedown','pointerup','mouseup','click'].forEach(t=>{
      b.dispatchEvent(new MouseEvent(t,{bubbles:true,cancelable:true,view:window}));
    });
    return true;
  })()`);

  console.log('[i] tunggu 20s menangkap ...');
  await sleep(20000);

  writeFileSync(OUT, JSON.stringify(captures, null, 2));
  console.log(`[i] total ${captures.length} request -> ${OUT}`);

  for (const c of captures) {
    if (c.url.includes('XqA3Ic')) {
      console.log('\n===== XqA3Ic =====');
      console.log('postData:', c.postData);
      console.log('status:', c.status);
      console.log('resp:', (c.responseBody||'').slice(0, 500));
    }
    if (c.type === 'media' || /audio|tts|speech/i.test(c.url)) {
      console.log('\n===== MEDIA =====');
      console.log(c.method, c.status, c.mimeType, c.url.slice(0, 300));
    }
  }
  process.exit(0);
}
main().catch((e) => { console.error('[x]', e.message); process.exit(1); });

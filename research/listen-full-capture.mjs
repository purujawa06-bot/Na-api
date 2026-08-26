#!/usr/bin/env node
/**
 * Klik Listen lalu tangkap SEMUA request (tanpa filter) + pantau elemen
 * audio/video di DOM — untuk melihat mekanisme pemutaran suara yang sebenarnya.
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CDP_HTTP = process.env.CDP_URL || 'http://127.0.0.1:9222';
const OUT = join(dirname(fileURLToPath(import.meta.url)), '.gemini-listen-all.json');

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

  const reqs = [];
  listeners.push((msg) => {
    if (msg.method === 'Network.requestWillBeSent') {
      const r = msg.params.request;
      try {
        const u = new URL(r.url);
        if (u.protocol === 'data:') return;
      } catch { return; }
      reqs.push({
        ts: Date.now(),
        url: r.url.slice(0, 500),
        method: r.method,
        type: msg.params.type || '',
        mime: r.headers && r.headers['content-type'] || '',
        postDataLen: r.postData ? r.postData.length : 0,
        postDataHead: r.postData ? r.postData.slice(0, 300) : null,
      });
    }
    if (msg.method === 'Network.responseReceived') {
      const m = reqs.find((x) => x.url === msg.params.response.url.slice(0, 500) && !x.status);
      if (m) { m.status = msg.params.response.status; m.respMime = msg.params.response.mimeType; }
    }
  });

  // buka menu + klik Listen
  console.log('[i] buka menu & klik Listen ...');
  await evalJs(`(() => {
    const btns=[...document.querySelectorAll('button')].filter(b=>/show more options/i.test(b.getAttribute('aria-label')||''));
    btns[btns.length-1]?.click();
    setTimeout(() => {
      const b=[...document.querySelectorAll('button')].filter(x=>/^listen$/i.test((x.getAttribute('aria-label')||'').trim())).pop();
      if(b) ['pointerdown','mousedown','pointerup','mouseup','click'].forEach(t=>{
        b.dispatchEvent(new MouseEvent(t,{bubbles:true,cancelable:true,view:window}));
      });
    }, 1200);
    return 'ok';
  })()`);

  // pantau DOM utk elemen audio + screenshot tiap 2s
  for (let i = 0; i < 10; i++) {
    await sleep(2000);
    const dom = await evalJs(`(() => {
      const audios=[...document.querySelectorAll('audio,video,audio-player,[aria-label*="udio" i],[jsname] ')].filter(e=>/audio|voice|speech/i.test(e.tagName+e.className+(e.getAttribute('aria-label')||'')));
      const dialog=[...document.querySelectorAll('[role="dialog"]')].map(d=>d.textContent.slice(0,150));
      const errSnack=document.querySelector('.snackbar-text, [aria-live]')?.textContent?.slice(0,150);
      return { audioCount:audios.length, dialog, errSnack };
    })()`);
    console.log(`[t+${(i+1)*2}s]`, JSON.stringify(dom));
  }

  writeFileSync(OUT, JSON.stringify(reqs, null, 1));
  console.log(`[i] total ${reqs.length} request -> ${OUT}`);

  // ringkas request non-statis
  console.log('\n===== REQUEST NON-STATIS =====');
  for (const r of reqs) {
    if (/batchexecute|StreamGenerate|audio|tts|speech|voice|playback|media/i.test(r.url)) {
      console.log(`${r.method} ${r.status||'?'} ${r.url.slice(0,140)}`);
      if (r.postDataHead) console.log('   body:', r.postDataHead.slice(0,200));
    }
  }
  process.exit(0);
}
main().catch((e) => { console.error('[x]', e.message); process.exit(1); });

#!/usr/bin/env node
/**
 * Buka share Gemini yang dikatakan user BERFUNGSI, klik Listen,
 * lalu bedah DOM: elemen audio/video/blob/iframe/speechSynthesis.
 */
const CDP_HTTP = process.env.CDP_URL || 'http://127.0.0.1:9222';
const SHARE_URL = 'https://gemini.google.com/share/a1e651123774?skid=c9cf9a10-dd78-42ef-a7b3-39c6b4c0ba4f';

let msgId = 0;
const pending = new Map();
let ws;
const listeners = [];
const consoleLogs = [];

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
async function evalJs(expression, awaitP = true) {
  const res = await sendCmd('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: awaitP });
  if (res.exceptionDetails) throw new Error(JSON.stringify(res.exceptionDetails).slice(0, 400));
  return res.result.value;
}

async function main() {
  const targets = await (await fetch(`${CDP_HTTP}/json/list`)).json();
  let page = targets.find((t) => t.type === 'page' && t.url.includes('a1e651123774'));
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => onMessage(e.data);

  await sendCmd('Runtime.enable');
  await sendCmd('Page.enable');

  // hook console + monitor pembuatan elemen audio & blob
  await evalJs(`(() => {
    window.__probe = { blobs: [], audios: [] };
    const origCreate = document.createElement.bind(document);
    document.createElement = function(tag, ...args) {
      const el = origCreate(tag, ...args);
      if (/^audio|video|source$/i.test(tag)) window.__probe.audios.push({tag, ts: Date.now(), srcSet: false});
      return el;
    };
    const origCreateObjectURL = URL.createObjectURL.bind(URL);
    URL.createObjectURL = function(obj) {
      const url = origCreateObjectURL(obj);
      try { window.__probe.blobs.push({ type: obj && obj.type || (obj && obj.constructor && obj.constructor.name), size: obj && obj.size, url }); } catch {}
      return url;
    };
    // hook speechSynthesis
    if ('speechSynthesis' in window) {
      const origSpeak = speechSynthesis.speak.bind(speechSynthesis);
      speechSynthesis.speak = function(u) { window.__probe.speechSynthUsed = true; window.__probe.lastUtterance = (u.text||'').slice(0,200); return origSpeak(u); };
    }
    return 'hooks installed';
  })()`);

  // reload halaman agar state bersih
  await sendCmd('Page.navigate', { url: SHARE_URL });
  await sleep(12000);

  const domBefore = await evalJs(`(() => {
    const btns=[...document.querySelectorAll('button')].map(b=>(b.getAttribute('aria-label')||b.textContent||'').trim()).filter(t=>t&&t.length<40);
    return [...new Set(btns)].slice(0,30);
  })()`);
  console.log('[i] tombol:', JSON.stringify(domBefore));

  // klik Listen
  const clicked = await evalJs(`(() => {
    const b=[...document.querySelectorAll('button')].filter(x=>/^listen$/i.test((x.getAttribute('aria-label')||x.textContent||'').trim())).pop();
    if(!b) return 'NO_BTN';
    b.click();
    return 'clicked real .click()';
  })()`);
  console.log('[i]', clicked);
  await sleep(15000);

  const probe = await evalJs(`(() => ({
    probe: window.__probe,
    audioEls: [...document.querySelectorAll('audio, video, source')].map(a=>({tag:a.tagName, src:(a.src||'').slice(0,120)})),
    iframes: [...document.querySelectorAll('iframe')].map(f=>f.src.slice(0,100)),
    speechSynthAvailable: 'speechSynthesis' in window,
  }))()`);
  console.log(JSON.stringify(probe, null, 1));

  process.exit(0);
}
main().catch((e) => { console.error('[x]', e.message); process.exit(1); });

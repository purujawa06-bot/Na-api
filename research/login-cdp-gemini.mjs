#!/usr/bin/env node
/**
 * Injeksikan cookie login google.com (dari scripts/.gemini-cookies.json)
 * ke browser CDP agar share page terbaca sebagai sesi login,
 * lalu reload share dan verifikasi tombol "Sign in" hilang.
 */
import { readFileSync } from 'node:fs';

const CDP_HTTP = process.env.CDP_URL || 'http://127.0.0.1:9222';
const SHARE_URL = process.env.GSHARE_URL || 'https://gemini.google.com/share/a1e651123774';

let msgId = 0;
const pending = new Map();
let ws;

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
    msg.error ? reject(new Error(`${msg.error.message} ${msg.error.data || ''}`)) : resolve(msg.result);
  }
}
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
async function evalJs(expression) {
  const res = await sendCmd('Runtime.evaluate', { expression, returnByValue: true });
  if (res.exceptionDetails) throw new Error(JSON.stringify(res.exceptionDetails).slice(0, 300));
  return res.result.value;
}

async function main() {
  const arr = JSON.parse(readFileSync('scripts/.gemini-cookies.json', 'utf8'));
  const targets = await (await fetch(`${CDP_HTTP}/json/list`)).json();
  // pakai tab share yang sudah ada (atau tab gemini mana pun)
  const page =
    targets.find((t) => t.type === 'page' && t.url.includes('gemini.google.com')) ||
    targets.find((t) => t.type === 'page');
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => onMessage(e.data);

  await sendCmd('Network.enable');

  // injek semua cookie .google.com + accounts.google.com + gemini.google.com
  let injected = 0;
  for (const c of arr) {
    if (!['.google.com', 'accounts.google.com', '.gemini.google.com'].includes(c.domain)) continue;
    try {
      await sendCmd('Network.setCookie', {
        name: c.name,
        value: c.value,
        domain: c.domain,
        path: c.path || '/',
        secure: c.secure !== false,
        httpOnly: !!c.httpOnly,
      });
      injected++;
    } catch {}
  }
  console.log(`[i] ${injected} cookie diinjeksi`);

  // reload share page
  await sendCmd('Page.enable');
  await sendCmd('Page.navigate', { url: SHARE_URL });
  await sleep(12000);

  const state = await evalJs(`(() => {
    const btns=[...document.querySelectorAll('button')].map(b=>(b.getAttribute('aria-label')||b.textContent||'').trim()).filter(t=>t&&t.length<40);
    return { signInVisible: btns.some(t=>/^sign in$/i.test(t)), buttons:[...new Set(btns)].slice(0,25) };
  })()`);
  console.log('[i] state setelah login:', JSON.stringify(state, null, 1));
  process.exit(state.signInVisible ? 1 : 0);
}
main().catch((e) => { console.error('[x]', e.message); process.exit(1); });

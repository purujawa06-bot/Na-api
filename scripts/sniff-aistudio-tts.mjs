#!/usr/bin/env node
/**
 * Sniff AI Studio generate-speech: pantau request API saat halaman load
 * + cek apakah user login & tombol generate tersedia.
 */
const CDP_HTTP = process.env.CDP_URL || 'http://127.0.0.1:9222';

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
  const page = targets.find((t) => t.type === 'page' && t.url.includes('aistudio.google.com'));
  if (!page) throw new Error('tab aistudio tidak ada');
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => onMessage(e.data);

  await sendCmd('Network.enable');
  const reqs = [];
  listeners.push((msg) => {
    if (msg.method === 'Network.requestWillBeSent') {
      const r = msg.params.request;
      if (/googleapis|batchexecute|Assist|Generate/i.test(r.url)) {
        reqs.push({ url: r.url.slice(0, 250), method: r.method, post: r.postData ? r.postData.slice(0, 500) : null });
      }
    }
  });

  console.log('[i] tunggu 15s halaman termuat ...');
  await sleep(15000);

  const info = await evalJs(`(() => ({
    url: location.href,
    title: document.title,
    bodySnippet: document.body.innerText.slice(0, 600),
    hasSignIn: !!document.querySelector('a[href*="ServiceLogin"]'),
  }))()`);
  console.log(JSON.stringify(info, null, 1));
  console.log('\n=== requests:', reqs.length);
  for (const r of reqs) console.log(r.method, r.url);
  process.exit(0);
}
main().catch((e) => { console.error('[x]', e.message); process.exit(1); });

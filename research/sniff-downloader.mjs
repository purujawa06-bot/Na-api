// Sniff alur request situs downloader. Jalankan: node scripts/sniff-downloader.mjs <url-situs>
const CDP_HTTP = process.env.CDP_URL || 'http://127.0.0.1:9222';
const SITE = process.argv[2];
const YT = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
if (!SITE) {
  console.error('usage: node sniff-downloader.mjs https://ddown.to/id/');
  process.exit(1);
}

async function newTab(url) {
  let res = await fetch(`${CDP_HTTP}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' });
  if (!res.ok) res = await fetch(`${CDP_HTTP}/json/new?${encodeURIComponent(url)}`);
  return res.json();
}

const tab = await newTab(SITE);
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((r, j) => ((ws.onopen = r), (ws.onerror = j)));

let id = 0;
const pending = new Map();
const bodies = new Map(); // requestId -> {url, method, postData}
ws.onmessage = async (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m);
    pending.delete(m.id);
    return;
  }
  const { method, params } = m;
  if (method === 'Network.requestWillBeSent') {
    const r = params.request;
    const type = params.type || '';
    const staticRes = /\.(js|css|png|jpg|svg|woff|ico)(\?|$)/i.test(r.url);
    if (!staticRes && (type === 'XHR' || type === 'Fetch' || type === 'EventSource' || r.method === 'POST')) {
      bodies.set(params.requestId, { url: r.url, method: r.method, postData: r.postData });
      console.log(`\n>> [${type}] ${r.method} ${r.url}`);
      if (r.postData) console.log(`   body: ${String(r.postData).slice(0, 300)}`);
    }
  }
  if (method === 'Network.loadingFinished' && bodies.has(params.requestId)) {
    const info = bodies.get(params.requestId);
    try {
      const rb = await send('Network.getResponseBody', { requestId: params.requestId });
      const txt = rb.base64Encoded ? Buffer.from(rb.body, 'base64').toString() : rb.body;
      console.log(`<< ${info.url.slice(0, 100)}\n   ${txt.slice(0, 400).replace(/\n/g, ' ')}`);
    } catch {}
  }
};
function send(method, params = {}) {
  return new Promise((resolve) => {
    const mid = ++id;
    pending.set(mid, resolve);
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
}
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

await send('Page.enable');
await send('Network.enable');
await sleep(5000); // tunggu halaman siap

await send('Runtime.evaluate', {
  expression: `(() => {
    const inp = document.querySelector('input[type=text],input[type=url]') ||
                [...document.querySelectorAll('input')].find(i => i.offsetParent);
    if (!inp) return 'NO_INPUT';
    inp.value = ${JSON.stringify(YT)};
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    const btn = [...document.querySelectorAll('button,a[role=button],input[type=submit]')]
      .find(b => /download|convert|mulai|start|go|cari/i.test(b.innerText || b.value || ''));
    if (btn) { btn.click(); return 'CLICKED:' + (btn.innerText || btn.value); }
    const f = inp.closest('form');
    if (f) { f.submit(); return 'SUBMITTED_FORM'; }
    return 'NO_BUTTON';
  })()`,
  returnByValue: true,
}).then((r) => console.log('[aksi]', JSON.stringify(r.result?.result?.value ?? r.result?.value)));

console.log('[*] merekam trafik 30 detik...');
await sleep(30000);

await fetch(`${CDP_HTTP}/json/close/${tab.id}`);
ws.close();
process.exit(0);

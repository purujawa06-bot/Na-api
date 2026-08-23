import { writeFileSync } from 'node:fs';
const CDP_HTTP = 'http://127.0.0.1:9222';
const BASE = 'https://gemini.google.com';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const targets = await fetch(CDP_HTTP + '/json/list').then(r => r.json());
let page = targets.find(t => t.type === 'page' && t.url.includes('gemini.google.com') && t.webSocketDebuggerUrl);
if (!page) page = await fetch(CDP_HTTP + '/json/new?url=' + encodeURIComponent(BASE + '/app'), { method: 'PUT' }).then(r => r.json());
const ws = new WebSocket(page.webSocketDebuggerUrl);
ws._ls = new Set();
ws.onmessage = (ev) => { const raw = typeof ev === 'string' ? ev : (ev && ev.data !== undefined ? (typeof ev.data === 'string' ? ev.data : String(ev.data)) : String(ev)); for (const fn of ws._ls) fn(raw); };
await new Promise(res => ws.addEventListener('open', res));
const cmd = (method, params = {}) => new Promise((res, rej) => { const id = Math.floor(Math.random() * 1e6) + 1; const fn = (raw) => { const m = JSON.parse(raw); if (m.id === id) { ws._ls.delete(fn); m.error ? rej(new Error(m.error.message)) : res(m.result); } }; ws._ls.add(fn); ws.send(JSON.stringify({ id, method, params })); });
const ev = (e) => cmd('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }).then(r => r.result?.value);
await cmd('Network.enable');
await cmd('Emulation.setDeviceMetricsOverride', { width: 412, height: 915, deviceScaleFactor: 2, mobile: true });
await cmd('Page.navigate', { url: BASE + '/app' });
await sleep(9000);
const out = {};
for (const model of ['3.6 Flash', '3.1 Pro']) {
  let l5 = null;
  const h = (raw) => { try { const m = JSON.parse(raw); if (m.method === 'Network.requestWillBeSent' && m.params.request.url.includes('L5adhe') && m.params.request.postData) l5 = m.params.request.postData; } catch {} };
  ws._ls.add(h);
  await ev('(document.querySelector("bard-mode-switcher button, .gds-mode-switch-button")||{}).click?.();');
  await sleep(1800);
  await ev('(() => { const items = [...document.querySelectorAll(".cdk-overlay-pane gem-menu-item, .cdk-overlay-pane [role=menuitemradio]")]; const el = items.find(o => (o.textContent||"").includes(' + JSON.stringify(model) + ')); if (el) el.click(); return 1; })()');
  await sleep(3000);
  ws._ls.delete(h);
  if (l5) { const p = new URLSearchParams(l5); const fr = p.get('f.req'); try { out[model] = JSON.parse(fr); } catch { out[model] = fr?.slice(0,300); } }
}
writeFileSync('./scripts/.l5adhe-codes.json', JSON.stringify(out, null, 0));
console.log('flash:', JSON.stringify(out['3.6 Flash']).slice(0, 200));
console.log('pro:', JSON.stringify(out['3.1 Pro']).slice(0, 200));
console.log('saved .l5adhe-codes.json');
process.exit(0);

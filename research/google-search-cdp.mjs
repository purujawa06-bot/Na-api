// Pencarian via Chrome CDP (tab baru, hasil organik Google).
// Jalankan: node scripts/google-search-cdp.mjs "query di sini"
const CDP_HTTP = process.env.CDP_URL || 'http://127.0.0.1:9222';
const q = process.argv.slice(2).join(' ');
if (!q) {
  console.error('usage: node google-search-cdp.mjs "<query>"');
  process.exit(1);
}

async function newTab(url) {
  // Chrome modern mewajibkan PUT untuk /json/new
  let res = await fetch(`${CDP_HTTP}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' });
  if (!res.ok) res = await fetch(`${CDP_HTTP}/json/new?${encodeURIComponent(url)}`);
  return res.json();
}

const tab = await newTab('about:blank');
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));

let id = 0;
const pending = new Map();
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m);
    pending.delete(m.id);
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
let url = `https://www.google.com/search?q=${encodeURIComponent(q)}&num=15&hl=id`;
await send('Page.navigate', { url });
await sleep(4000);
const chk = await send('Runtime.evaluate', { expression: 'location.href', returnByValue: true });
if ((chk.result?.value || '').includes('/sorry/')) {
  console.log('[!] Google captcha -> fallback DuckDuckGo');
  url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`;
  await send('Page.navigate', { url });
  await sleep(3500);
}

const raw = await send('Runtime.evaluate', {
  expression: `(() => {
    const out = [];
    const seen = new Set();
    const push = (a, tSel, boxSel) => {
      const tEl = a.querySelector(tSel) || a;
      if (!tEl || seen.has(a.href)) return;
      seen.add(a.href);
      const box = boxSel ? a.closest(boxSel) : null;
      out.push({ title: tEl.innerText.trim(), url: a.href, snippet: (box ? box.innerText : '').replace(/\\n+/g, ' | ').slice(0, 260) });
    };
    for (const h3 of document.querySelectorAll('#search a h3')) {
      const a = h3.closest('a'); if (a) push(a, 'h3', 'div.g');
    }
    for (const a of document.querySelectorAll('.result__a')) push(a, '', '.result');
    for (const a of document.querySelectorAll('#links a[href^="http"]')) if (a.querySelector('.result__title') || a.classList.contains('result__a')) push(a, '', '.result');
    if (!out.length) out.push({ title: 'NO_RESULTS', url: location.href, snippet: document.body.innerText.slice(0, 300).replace(/\\n+/g, ' ') });
    return JSON.stringify(out);
  })()`,
  returnByValue: true,
});

const val = raw.result?.result?.value ?? raw.result?.value;
if (!val) {
  console.error('evaluate gagal:', JSON.stringify(raw).slice(0, 500));
  process.exit(1);
}
console.log(JSON.parse(val).map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`).join('\n'));

await fetch(`${CDP_HTTP}/json/close/${tab.id}`);
ws.close();
process.exit(0);

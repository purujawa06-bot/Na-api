#!/usr/bin/env node
/** Inspeksi DOM halaman gemini.google.com/app: cari tombol & status generasi */
const CDP_HTTP = process.env.CDP_URL || 'http://127.0.0.1:9222';

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
    msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
  }
}

async function main() {
  const targets = await (await fetch(`${CDP_HTTP}/json/list`)).json();
  const page = targets.find((t) => t.type === 'page' && t.url.includes('gemini.google.com/app'));
  if (!page) throw new Error('tidak ada tab gemini /app');
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (e) => onMessage(e.data);

  const evalJs = async (expression) => {
    const res = await sendCmd('Runtime.evaluate', { expression, returnByValue: true });
    if (res.exceptionDetails) throw new Error(JSON.stringify(res.exceptionDetails).slice(0, 400));
    return res.result.value;
  };

  const info = await evalJs(`(() => {
    const allBtns = [...document.querySelectorAll('button')].map(b => b.getAttribute('aria-label')).filter(Boolean);
    const stop = allBtns.filter(l => /stop|hentikan/i.test(l));
    const modelResp = document.querySelectorAll('model-response').length;
    const lastText = [...document.querySelectorAll('model-response')].pop();
    return {
      url: location.href.slice(0, 90),
      totalButtons: allBtns.length,
      labels: [...new Set(allBtns)].slice(0, 40),
      stopVisible: stop,
      modelResponseCount: modelResp,
      lastRespSnippet: lastText ? lastText.textContent.slice(0, 200) : null,
    };
  })()`);
  console.log(JSON.stringify(info, null, 1));
  process.exit(0);
}
main().catch((e) => { console.error('[x]', e.message); process.exit(1); });

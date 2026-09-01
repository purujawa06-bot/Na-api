/**
 * Capture network via CDP (port json/127.0.0.1:9222), pola sniffing skill.
 * Menempel pada target page quillbot, mencatat request/response 60 detik,
 * lalu simpan raw hasil ke scripts/<name>.raw.sniff.json.
 *
 * Pakai: node scripts/cdp-capture.mjs [durasiDetik] [nama]
 */
import WebSocket from 'ws';

const DURATION = Number(process.argv[2] || 75);
const NAME = process.argv[3] || 'quillbot';
const UNIX = +new Date();

async function findPageTarget() {
  const res = await fetch('http://127.0.0.1:9222/json');
  const list = await res.json();
  return list.find((t) => t.type === 'page' && /quillbot/i.test(t.url)) || list.find((t) => t.type === 'page');
}

let msgId = 0;
const pending = new Map();

function send(ws, method, params = {}) {
  const id = ++msgId;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

const tracked = new Map(); // requestId -> meta
const byUrl = new Map(); // url -> requestId terakhir
async function getBody(ws, requestId) {
  try {
    const r = await send(ws, 'Network.getResponseBody', { requestId });
    const b = r.result?.body ?? '';
    return b.length > 300000 ? b.slice(0, 300000) + '\n[TRUNCATED]' : b;
  } catch {
    return null;
  }
}

const target = await findPageTarget();
if (!target) { console.error('Tidak ada target page (CDP di 127.0.0.1:9222?).'); process.exit(1); }
console.log(`[cdp] target: ${target.title} | ${target.url}`);

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej); });
console.log('[cdp] websocket tersambung, Network.enable…');

ws.on('message', (buf) => {
  const ev = JSON.parse(buf.toString());
  if (ev.id && pending.has(ev.id)) {
    const p = pending.get(ev.id);
    pending.delete(ev.id);
    if (ev.error) p.reject(new Error(ev.error.message));
    else p.resolve(ev.result || ev);
    return;
  }
  const m = ev.method;
  const p = ev.params ?? {};
  if (m === 'Network.requestWillBeSent') {
    const meta = tracked.get(p.requestId) || {};
    tracked.set(p.requestId, {
      url: p.request?.url,
      method: p.request?.method,
      requestHeaders: p.request?.headers,
      postData: p.request?.postData ?? p.request?.postDataEntries?.[0]?.bytes,
      ts: p.timestamp,
      type: p.type,
      ...meta,
    });
    byUrl.set(p.request?.url, p.requestId);
  } else if (m === 'Network.responseReceived') {
    const meta = tracked.get(p.requestId) || {};
    tracked.set(p.requestId, {
      ...meta,
      status: p.response?.status,
      responseHeaders: { 'content-type': p.response?.mimeType } ,
      responseMime: p.response?.mimeType,
    });
  }
  void m; void p;
});

await send(ws, 'Network.enable', {});

console.log(`[cdp] === INTERAKSIKAN FITUR QUILLBOT SEKARANG — ${DURATION} DETIK ===`);
const dl = setInterval(() => process.stdout.write(`\r[cdp] sisa ${Math.max(0,  --waitCount)}s`), 1000);
let waitCount = DURATION;
await new Promise((r) => setTimeout(r, DURATION * 1000));
clearInterval(dl); process.stdout.write('\n');

const rows = [];
let done = 0, total = tracked.size;
for (const [requestId, meta] of tracked) {
  const row = { ...meta };
  if (row.responseMime && /json|text|xml|stream/i.test(row.responseMime))
    row.responseBody = await getBody(ws, requestId);
  delete row.responseMime;
  rows.push(row);
  process.stdout.write(`\r[cdp] ambil body ${++done}/${total}`);
}
process.stdout.write('\n');

ws.close();
const out = `scripts/${NAME}.raw.sniff.json`;
await (await import('node:fs')).promises.writeFile(out, JSON.stringify(rows, null, 2));
console.log(`[cdp] selesai: ${rows.length} request -> ${out}`);
void UNIX;
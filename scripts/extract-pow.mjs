#!/usr/bin/env node
/**
 * Ekstrak implementasi PoW (DeepSeekHashV1) dari JS bundle chat.deepseek.com
 * lewat CDP Debugger.getScriptSource.
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CDP_HTTP = process.env.CDP_URL || 'http://127.0.0.1:9222';
const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)));

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

const scripts = [];
let wsMsgHandler;

async function main() {
  const targets = await (await fetch(`${CDP_HTTP}/json/list`)).json();
  const page = targets.find((t) => t.type === 'page' && t.url.includes('chat.deepseek.com'));
  if (!page) throw new Error('tab chat.deepseek.com tidak ditemukan');

  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
      return;
    }
    wsMsgHandler?.(msg);
  };

  await sendCmd('Debugger.enable');
  console.log('[i] mengumpulkan scripts...');

  wsMsgHandler = async (msg) => {
    if (msg.method !== 'Debugger.scriptParsed') return;
    const { scriptId, url, length } = msg.params;
    try {
      const { scriptSource } = await sendCmd('Debugger.getScriptSource', { scriptId });
      scripts.push({ url: url || '(inline)', src: scriptSource, length });
    } catch {}
  };

  // reload untuk parse semua script dari awal
  await sendCmd('Page.enable');
  await sendCmd('Page.reload', { ignoreCache: true });

  await new Promise((r) => setTimeout(r, 15000));
  console.log(`[i] ${scripts.length} scripts terkumpul`);

  const patterns = ['DeepSeekHashV1', 'pow-response', 'x-ds-pow', 'create_pow_challenge', 'difficulty'];
  const hits = [];
  for (const s of scripts) {
    for (const p of patterns) {
      let idx = s.src.indexOf(p);
      while (idx !== -1) {
        hits.push({ url: s.url, pattern: p, idx, src: s.src });
        idx = s.src.indexOf(p, idx + 1);
        if (hits.length > 200) break;
      }
    }
  }

  console.log(`[i] ${hits.length} kemunculan pola PoW`);
  const uniqUrls = [...new Set(hits.map((h) => h.url))];
  console.log('[i] file berisi kode PoW:', uniqUrls);

  // simpan cuplikan konteks sekitar tiap kejadian unik
  const seen = new Set();
  let out = '';
  for (const h of hits) {
    const key = h.url + ':' + Math.max(0, h.idx - 400);
    if (seen.has(key)) continue;
    seen.add(key);
    out += `\n/* ===== ${h.pattern} @ ${h.url} ===== */\n`;
    out += h.src.slice(Math.max(0, h.idx - 600), h.idx + 1600);
    out += '\n\n';
    if (out.length > 120000) break;
  }
  writeFileSync(join(OUT_DIR, '.deepseek-pow-code.txt'), out);
  console.log(`[i] cuplikan -> .deepseek-pow-code.txt (${out.length} chars)`);

  process.exit(0);
}

main().catch((e) => { console.error('[x]', e.message); process.exit(1); });

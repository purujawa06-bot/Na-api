#!/usr/bin/env node
/**
 * Ambil userToken chat.deepseek.com dari Brave (CDP port 9222)
 * untuk dipakai sebagai env DEEPSEEK_TOKEN di produksi/Vercel.
 *
 * Usage: node scripts/get-deepseek-token.mjs
 */
const CDP_HTTP = process.env.CDP_URL || 'http://127.0.0.1:9222';

async function main() {
  const targets = await (await fetch(`${CDP_HTTP}/json/list`)).json();
  let page = targets.find((t) => t.type === 'page' && t.url.includes('chat.deepseek.com'));
  if (!page) {
    page = await (
      await fetch(`${CDP_HTTP}/json/new?url=${encodeURIComponent('https://chat.deepseek.com/')}`, { method: 'PUT' })
    ).json();
    console.error('[i] tab baru dibuat, tunggu halaman siap ...');
    await new Promise((r) => setTimeout(r, 8000));
  }

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

  const value = await new Promise((resolve) => {
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.id === 1) resolve(m.result?.result?.value ?? null);
    };
    ws.send(JSON.stringify({
      id: 1,
      method: 'Runtime.evaluate',
      params: { expression: "localStorage.getItem('userToken')", returnByValue: true },
    }));
    setTimeout(() => resolve(null), 5000);
  });
  ws.close();

  if (!value) {
    console.error('[x] userToken tidak ditemukan. Login dulu ke chat.deepseek.com di Brave.');
    process.exit(1);
  }
  const token = JSON.parse(value).value;
  console.log('\nDEEPSEEK_TOKEN=' + token);
  console.log('\n[i] salin baris di atas ke .env atau `vercel env add DEEPSEEK_TOKEN`');
}

main().catch((e) => { console.error('[x]', e.message); process.exit(1); });

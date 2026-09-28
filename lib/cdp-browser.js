/**
 * Shared remote-CDP browser client (Lightpanda).
 *
 * Transport: WebSocket CDP to `CDP_WS_URL` (`BING_CDP_URL` kept as alias,
 * default `wss://browser-yq20.onrender.com/`).
 *
 * Flow per render: connect -> `Target.createTarget({url:'about:blank'})`
 * -> `Target.attachToTarget` -> `Page.enable` + explicit `Page.navigate`
 * (createTarget with a URL does not reliably re-navigate the reused tab)
 * -> wait for `Page.loadEventFired` + settle delay -> `LP.dump({format:'html'})`.
 *
 * Cleanup in `finally` closes ALL page targets (best-effort, so no tab
 * leaks on the shared remote browser even on mid-request failure) + WS close.
 *
 * NOTE: the remote browser reuses a single tab, so concurrent renders
 * from one process MUST run sequentially — one's close-all would kill
 * the other's tab.
 */

import WebSocket from 'ws';

const CDP_WS_URL =
  process.env.CDP_WS_URL || process.env.BING_CDP_URL || 'wss://browser-yq20.onrender.com/';

/** Overall CDP operation timeout (ms) — must stay under route maxDuration. */
const CDP_TIMEOUT_MS = 30000;

/** Extra settle delay after load event (ms) for JS redirects. */
export const CDP_SETTLE_MS = 2500;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Render any URL in the remote CDP browser and return raw HTML.
 * WS + all tabs are always cleaned up, even on failure.
 * @param {string} url - Page URL to render.
 * @param {object} [opts] - Options.
 * @param {number} [opts.settleMs=2500] - Extra wait after load event (ms).
 * @param {number} [opts.loadTimeoutMs=15000] - Max wait for load event (ms).
 * @returns {Promise<string>} Rendered page HTML.
 */
export async function fetchHtmlViaCdp(url, opts = {}) {
  const settleMs = Number(opts.settleMs) || CDP_SETTLE_MS;
  const loadTimeoutMs = Number(opts.loadTimeoutMs) || 15000;
  const ws = new WebSocket(CDP_WS_URL, { handshakeTimeout: 15000 });
  await new Promise((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
    setTimeout(() => reject(new Error('CDP connect timeout')), 15000);
  });

  let nextId = 1;
  const pending = new Map();
  let loadFired = false;
  let targetId = null;

  const onMessage = (raw) => {
    let msg;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return;
    }
    if (msg?.method === 'Page.loadEventFired') loadFired = true;
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(`CDP: ${msg.error.message || JSON.stringify(msg.error)}`));
      else resolve(msg);
    }
  };
  ws.on('message', onMessage);

  const send = (method, params = {}, sessionId, timeoutMs = CDP_TIMEOUT_MS) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      const msg = { id, method, params };
      if (sessionId) msg.sessionId = sessionId;
      ws.send(JSON.stringify(msg), (err) => {
        if (err) {
          pending.delete(id);
          reject(err);
        }
      });
      setTimeout(() => {
        if (pending.has(id)) {
          pending.delete(id);
          reject(new Error(`CDP timeout: ${method}`));
        }
      }, timeoutMs);
    });

  try {
    const created = await send('Target.createTarget', { url: 'about:blank' });
    targetId = created?.result?.targetId;
    if (!targetId) throw new Error('CDP: createTarget returned no targetId');
    const attached = await send('Target.attachToTarget', { targetId, flatten: true });
    const sessionId = attached?.result?.sessionId;
    if (!sessionId) throw new Error('CDP: attachToTarget returned no sessionId');

    await send('Page.enable', {}, sessionId);
    loadFired = false;
    await send('Page.navigate', { url }, sessionId);

    const t0 = Date.now();
    while (!loadFired && Date.now() - t0 < loadTimeoutMs) await sleep(500);
    // Skip settle when load never fired (blocked/timeout navigation):
    // the dump below fails fast on the short error page instead.
    if (loadFired) await sleep(settleMs);

    const dump = await send('LP.dump', { format: 'html', maxBytes: 2000000 }, sessionId);
    const html = dump?.result?.content;
    if (typeof html !== 'string' || html.length < 10000) {
      throw new Error('CDP: empty/short HTML from LP.dump');
    }
    return html;
  } finally {
    try {
      const listed = await send('Target.getTargets', {}, undefined, 8000);
      const infos = listed?.result?.targetInfos || [];
      for (const info of infos) {
        if (info?.type !== 'page' || !info?.targetId) continue;
        try {
          await send('Target.closeTarget', { targetId: info.targetId }, undefined, 3000);
        } catch {
          /* ignore per-tab */
        }
      }
    } catch {
      if (targetId) {
        try {
          await send('Target.closeTarget', { targetId }, undefined, 5000);
        } catch {
          /* ignore cleanup errors */
        }
      }
    }
    try {
      ws.removeListener('message', onMessage);
      ws.close();
    } catch {
      /* ignore */
    }
  }
}

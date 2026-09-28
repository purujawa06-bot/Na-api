/**
 * Web search via Bing HTML rendered in a remote CDP browser.
 *
 * Transport: WebSocket CDP to `BING_CDP_URL`
 * (default `wss://browser-yq20.onrender.com/` — Lightpanda).
 * Flow per search: connect -> `Target.createTarget({url})` (Bing search URL)
 * -> `Target.attachToTarget` -> wait for `Page.loadEventFired` + extra delay
 * -> `LP.dump({format:'html'})` -> parse `li.b_algo` -> cleanup
 * (close ALL page targets + WS close in `finally`, so no tab leaks
 * on the shared remote browser even when a request fails mid-way).
 *
 * No API key, no cookies, no fetch guards — real browser rendering
 * bypasses Bing datacenter blocks that break plain Node fetch.
 */

import WebSocket from 'ws';

const CDP_WS_URL = process.env.BING_CDP_URL || 'wss://browser-yq20.onrender.com/';

/** Overall CDP operation timeout (ms) — must stay under route maxDuration. */
const CDP_TIMEOUT_MS = 30000;

/** Extra settle delay after load event (ms) for Bing JS redirect (rdr=1). */
const SETTLE_MS = 2500;

/** Search result cache TTL (10 minutes) + cap to avoid leaks. */
const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_MAX_ENTRIES = 300;

/** In-memory search cache: key `${query}:${limit}` -> { at, data }. */
const searchCache = new Map();

function cacheGet(key) {
  const hit = searchCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    searchCache.delete(key);
    return null;
  }
  return hit.data;
}

function cacheSet(key, data) {
  if (searchCache.size >= CACHE_MAX_ENTRIES) {
    searchCache.delete(searchCache.keys().next().value);
  }
  searchCache.set(key, { at: Date.now(), data });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Normalize a URL for de-duplication. */
function normalizeUrl(u) {
  try {
    const p = new URL(u);
    const host = p.hostname.toLowerCase().replace(/^www\./, '');
    let path = p.pathname.replace(/\/+$/, '');
    if (path === '') path = '/';
    return `${host}${path}`.toLowerCase();
  } catch {
    return String(u).trim().toLowerCase().replace(/\/+$/, '');
  }
}

/** Site name shown as `source` (hostname without www). */
function sourceOf(u) {
  try {
    return new URL(u).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

/** Strip tags + common entities to plain text. */
function cleanText(s) {
  return String(s || '')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&[^;]+;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Decode the real URL from Bing redirect `/ck/a?...&u=a1<base64>&...`.
 * @param {string} href - Raw href from the title anchor.
 * @returns {string|null} Decoded URL or null when not a known pattern.
 */
function decodeCkHref(href) {
  const m = String(href || '').match(/[?&]u=([A-Za-z0-9%+/_=-]+)/);
  if (!m) return null;
  let b64 = decodeURIComponent(m[1]);
  if (/^a1/i.test(b64)) b64 = b64.slice(2); // 2-char Bing prefix
  const pad = b64.length % 4;
  if (pad) b64 += '='.repeat(4 - pad);
  try {
    const url = Buffer.from(b64, 'base64').toString('utf8').replace(/\0/g, '');
    return /^https?:\/\/[^/]{3,200}/i.test(url) ? url : null;
  } catch {
    return null;
  }
}

/**
 * Parse organic hits from rendered Bing HTML.
 * @param {string} html - Full page HTML from `LP.dump`.
 * @returns {Array<{title:string, url:string, snippet:string|null, source:string}>}
 */
export function parseBingCdpResults(html) {
  const out = [];
  const blocks = String(html || '').split('<li class="b_algo"').slice(1);
  for (const b of blocks) {
    const raw = b.slice(0, 60000).replace(/&amp;/g, '&');
    const h2 = raw.match(
      /<h2[^>]*>\s*<a[^>]*href="([^"]{5,2000})"[^>]*>([\s\S]{1,500}?)<\/a>\s*<\/h2>/,
    );
    if (!h2) continue;
    let url = decodeCkHref(h2[1]);
    if (!url && /^https?:\/\//i.test(h2[1]) && !/bing\.com\//i.test(h2[1])) url = h2[1];
    if (!url) continue;
    let host = '';
    try {
      host = new URL(url).hostname.toLowerCase();
    } catch {
      continue;
    }
    if (/(^|\.)bing\.com$|(^|\.)microsoft\.com$/i.test(host)) continue;

    const title = cleanText(h2[2]).slice(0, 200);
    if (!title || title.length < 3) continue;

    let snippet = null;
    const cap = raw.match(/<div class="b_caption"[^>]*>\s*<p[^>]*>([\s\S]{1,800}?)<\/p>/);
    if (cap) {
      const t = cleanText(cap[1].split('<a class="b_algoReadMore')[0]).slice(0, 300);
      if (t.length >= 20) snippet = t;
    }
    out.push({ title, url, snippet, source: host.replace(/^www\./, '') });
  }
  return out;
}

/**
 * Render a Bing search page in the remote CDP browser and return raw HTML.
 * WS + target are always cleaned up, even on failure.
 * @param {string} query - Search keywords.
 * @returns {Promise<string>} Rendered page HTML.
 */
async function fetchBingHtmlViaCdp(query) {
  // URL polos disengaja: parameter setlang/cc/count terbukti memicu
  // halaman "tidak ada hasil" / degradasi dari IP datacenter.
  const bingUrl = `https://www.bing.com/search?q=${encodeURIComponent(query)}`;
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
    // Tab kosong dulu lalu navigasi eksplisit: createTarget dengan URL
    // langsung tak selalu navigasi ulang (tab dipakai ulang di server).
    const created = await send('Target.createTarget', { url: 'about:blank' });
    targetId = created?.result?.targetId;
    if (!targetId) throw new Error('CDP: createTarget returned no targetId');
    const attached = await send('Target.attachToTarget', { targetId, flatten: true });
    const sessionId = attached?.result?.sessionId;
    if (!sessionId) throw new Error('CDP: attachToTarget returned no sessionId');

    await send('Page.enable', {}, sessionId);
    loadFired = false;
    await send('Page.navigate', { url: bingUrl }, sessionId);

    // Wait for load event (max 15s), then extra settle for Bing JS redirect.
    const t0 = Date.now();
    while (!loadFired && Date.now() - t0 < 15000) await sleep(500);
    await sleep(SETTLE_MS);

    const dump = await send('LP.dump', { format: 'html', maxBytes: 2000000 }, sessionId);
    const html = dump?.result?.content;
    if (typeof html !== 'string' || html.length < 10000) {
      throw new Error('CDP: empty/short HTML from LP.dump');
    }
    return html;
  } finally {
    // Tutup SEMUA tab page agar tak ada tab bocor di browser remote
    // (milik request ini maupun sisa gagal sebelumnya). Best-effort:
    // tiap close dibatasi 3 detik dan error diabaikan agar cleanup
    // tak pernah menggagalkan hasil search.
    try {
      const listed = await send('Target.getTargets', {}, undefined, 8000);
      const infos = listed?.result?.targetInfos || [];
      for (const info of infos) {
        if (info?.type !== 'page' || !info?.targetId) continue;
        try {
          await send('Target.closeTarget', { targetId: info.targetId }, undefined, 3000);
        } catch {
          /* abaikan per-tab */
        }
      }
    } catch {
      // Fallback: minimal tutup tab milik request ini bila listing gagal.
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

/**
 * Search the web via Bing rendered in the remote CDP browser.
 * @param {string} query - Search keywords.
 * @param {object} [opts] - Options.
 * @param {number} [opts.limit=10] - Max results (1-20).
 * @returns {Promise<{query:string, count:number, results:Array, source:string, cached:boolean}>}
 */
export async function searchBingCdp(query, opts = {}) {
  const q = String(query || '').trim();
  if (!q) throw new Error("Parameter 'query' is required.");
  const limit = Math.min(Math.max(parseInt(opts.limit, 10) || 10, 1), 20);

  const key = `bing-cdp:${q.toLowerCase()}:${limit}`;
  const hit = cacheGet(key);
  if (hit) return { ...hit, cached: true };

  const html = await fetchBingHtmlViaCdp(q);
  const parsed = parseBingCdpResults(html);
  const seen = new Set();
  const results = [];
  for (const r of parsed) {
    const k = normalizeUrl(r.url);
    if (seen.has(k)) continue;
    seen.add(k);
    results.push({
      title: r.title,
      url: r.url,
      snippet: r.snippet,
      source: r.source || sourceOf(r.url),
      engine: 'bing',
      rank: results.length + 1,
    });
    if (results.length >= limit) break;
  }
  if (!results.length) throw new Error('No results from Bing (CDP) for that query');

  const data = { query: q, count: results.length, results, source: 'bing' };
  cacheSet(key, data);
  return { ...data, cached: false };
}

// Konvergensi: eksekusi app.js + link.chunk.js dengan runtime webpack asli,
// tangkap require, panggil getSignedRequestBody (module 200.default),
// lalu POST /api/convert untuk verifikasi penuh.
import vm from 'node:vm';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const YT = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
const APP_URL = 'https://ddown.to/js/app.js?id=32fb09d6cd6543946e351c17d764b58b';

async function get(url) {
  return (
    await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20000) })
  ).text();
}

const appJs = await get(APP_URL);
// nama global chunk dari app.js
const gname = 'webpackChunk';
console.log('chunk global:', gname);

const sandbox = {
  console,
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval,
  AbortController,
  TextEncoder,
  TextDecoder,
  URL,
  URLSearchParams,
  crypto: (await import('node:crypto')).webcrypto,
  navigator: { userAgent: UA },
  location: new URL('https://ddown.to/id/'),
  document: {
    cookie: '',
    createElement: () => ({ style: {}, setAttribute() {}, appendChild() {}, remove() {} }),
    head: { appendChild() {} },
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener() {},
    getElementsByTagName: () => [],
  },
  XMLHttpRequest: function () {},
  fetch: undefined,
};
sandbox.window = sandbox;
sandbox.self = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

try {
  vm.runInContext(appJs, sandbox, { timeout: 15000 });
  console.log('app.js dieksekusi');
} catch (e) {
  console.log('app.js ERR:', String(e.message).slice(0, 120));
}
if (!sandbox[gname]) {
  console.log('global chunk tidak ketemu:', Object.keys(sandbox).filter((k) => /webpack/i.test(k)));
  process.exit(1);
}

// daftarkan modul chunk 909 manual (sudah kita tahu isinya) TANPA menjalankan lagi:
const chunkCode = await get('https://ddown.to/js/link.chunk.js?ch=f2cad82ff21d35ae.js');
try {
  vm.runInContext(chunkCode, sandbox, { timeout: 15000 });
  console.log('link.chunk dieksekusi');
} catch (e) {
  console.log('chunk ERR:', String(e.message).slice(0, 120));
}

// tangkap require lewat push modul runtime palsu
sandbox[gname].push([[999999], {}, (req) => (sandbox.__wpReq = req)]);
const req = sandbox.__wpReq;
if (!req) {
  console.log('gagal menangkap require');
  process.exit(1);
}
console.log('require tertangkap');

let signer;
try {
  const m200 = req(200);
  let d = m200.default;
  console.log('modul200.default typeof:', typeof d);
  if (d && typeof d === 'object') {
    for (const [k, v] of Object.entries(d)) {
      console.log(' .', k, '=', typeof v);
      if (!signer && typeof v === 'function') signer = v;
    }
  } else if (typeof d === 'function') {
    signer = d;
  }
} catch (e) {
  console.log('req(200) ERR:', String(e.message).slice(0, 150));
}

const q = '?url=' + encodeURIComponent(YT);
const signed = await signer(q);
console.log('SIGNED:', JSON.stringify(signed));

// verifikasi end-to-end
const page = await fetch('https://ddown.to/id/', { headers: { 'User-Agent': UA } });
const setc = page.headers.getSetCookie().map((c) => c.split(';')[0]);
const xsrf = decodeURIComponent(setc.find((c) => c.startsWith('XSRF-TOKEN='))?.split('=').slice(1).join('=') || '');
const conv = await fetch('https://ddown.to/api/convert', {
  method: 'POST',
  headers: {
    'User-Agent': UA,
    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
    Cookie: setc.join('; '),
    Referer: 'https://ddown.to/id/',
    Origin: 'https://ddown.to',
    'X-Requested-With': 'XMLHttpRequest',
    ...(xsrf ? { 'X-XSRF-TOKEN': xsrf } : {}),
  },
  body: new URLSearchParams(signed),
  signal: AbortSignal.timeout(45000),
});
const txt = await conv.text();
console.log('/api/convert', conv.status, txt.slice(0, 300));

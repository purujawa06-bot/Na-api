// Jalankan link.chunk.js ddown.to di sandbox node & panggil fungsi signing-nya.
import vm from 'node:vm';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131';
const rc = await fetch('https://ddown.to/js/link.chunk.js?ch=f2cad82ff21d35ae.js', {
  headers: { 'User-Agent': UA },
  signal: AbortSignal.timeout(20000),
});
const code = await rc.text();
console.log('chunk len:', code.length);
console.log('TAIL:', code.slice(-400));

const sandbox = {
  console,
  setTimeout,
  clearTimeout,
  TextEncoder,
  TextDecoder,
  navigator: { userAgent: UA },
  location: { href: 'https://ddown.to/id/' },
  document: { createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }), head: { appendChild() {} } },
  window: null,
  self: null,
  crypto: await import('node:crypto').then((c) => c.webcrypto),
};
sandbox.window = sandbox;
sandbox.self = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

try {
  vm.runInContext(code, sandbox, { timeout: 10000 });
} catch (e) {
  console.log('EVAL ERR:', e.message);
}

// chunk mendaftar via webpackChunk push; cari hasilnya
const pushed = sandbox.webpackChunk || [];
console.log('webpackChunk entries:', JSON.stringify(pushed.map((p) => p[0])));

const wpReq = Object.assign(
  (id) => {
    throw new Error('require ' + id);
  },
  {
    d: (exports, defs) => {
      for (const k of Object.keys(defs))
        Object.defineProperty(exports, k, { enumerable: true, get: defs[k] });
    },
    r: (exports) => {
      Object.defineProperty(exports, Symbol.toStringTag || '__esModule', { value: 'Module' });
      Object.defineProperty(exports, '__esModule', { value: true });
    },
    n: (m) => {
      const a = m && m.__esModule ? () => m.default : () => m;
      wpReq.d(a, { a });
      return a;
    },
    o: (obj, p) => Object.prototype.hasOwnProperty.call(obj, p),
  }
);

let signer = null;
for (const entry of pushed) {
  const mods = entry[1] || {};
  for (const [id, fn] of Object.entries(mods)) {
    const mod = { exports: {} };
    try {
      fn(mod, mod.exports, wpReq);
      console.log(`module ${id}: keys=${JSON.stringify(Object.keys(mod.exports))}`);
      const d = mod.exports.default;
      if (typeof d === 'function') signer = d;
    } catch (e) {
      console.log(`module ${id}: ERR ${e.message}`);
    }
  }
}
if (!signer) {
  // fallback: coba export 'sm' dari modul mana pun
  for (const entry of pushed) {
    const mods = entry[1] || {};
    for (const [id, fn] of Object.entries(mods)) {
      const mod = { exports: {} };
      try {
        fn(mod, mod.exports, wpReq);
        const sm = mod.exports.sm;
        console.log(`module ${id}.sm typeof=${typeof sm} keys=${typeof sm === 'object' && sm ? JSON.stringify(Object.keys(sm)) : '-'}`);
        if (typeof sm === 'function') {
          const r2 = await sm('?url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3DdQw4w9WgXcQ');
          console.log('SM RESULT:', JSON.stringify(r2));
          process.exit(0);
        }
        if (sm && typeof sm === 'object') {
          for (const k of Object.keys(sm)) {
            if (typeof sm[k] === 'function') {
              console.log('coba sm.' + k);
              const r3 = await sm[k]('?url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3DdQw4w9WgXcQ');
              console.log('SM.' + k + ' RESULT:', JSON.stringify(r3));
              process.exit(0);
            }
          }
        }
      } catch (e) {
        console.log(`module ${id}.sm ERR ${e.message.slice(0, 100)}`);
      }
    }
  }
  console.log('tidak ada signer');
  process.exit(1);
}
console.log('signer ok, memanggil...');
const out = await signer('?url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3DdQw4w9WgXcQ');
console.log('SIGNED RESULT:', JSON.stringify(out));

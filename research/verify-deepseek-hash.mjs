/**
 * Porting persis dari worker JS chat.deepseek.com (chunk 76608) - algoritma DeepSeekHashV1
 * Catatan: permutasi HANYA menjalankan round 1..23 (round 0 dilewati) -> bukan SHA3-256 standar.
 * Layout state: Uint32Array(50), lane k -> [2k]=hi32, [2k+1]=lo32 (sesuai fungsi I/A hasil decompile).
 */
import { createHash } from 'node:crypto';

const RC = new Uint32Array([
  0, 1, 0, 32898, 0x80000000, 32906, 0x80000000, 0x80008000, 0, 32907,
  0, 0x80000001, 0x80000000, 0x80008081, 0x80000000, 32777, 0, 138, 0, 136,
  0, 0x80008009, 0, 0x8000000a, 0, 0x8000808b, 0x80000000, 139, 0x80000000, 32905,
  0x80000000, 32771, 0x80000000, 32770, 0x80000000, 128, 0, 32778, 0x80000000, 0x8000000a,
  0x80000000, 0x80008081, 0x80000000, 32896, 0, 0x80000001, 0x80000000, 0x80008008,
]);

const PI = [10, 7, 11, 17, 18, 3, 5, 16, 8, 21, 24, 4, 15, 23, 19, 13, 12, 2, 20, 14, 22, 9, 6, 1];
const RHO = [1, 3, 6, 10, 15, 21, 28, 36, 45, 55, 2, 14, 27, 41, 56, 8, 25, 43, 62, 18, 39, 61, 20, 44];

const RATE = 136; // 200 - capacity(256)/4
const OUT_LEN = 32; // capacity/8

function keccakF(st) {
  const C = new Uint32Array(10);
  const D = new Uint32Array(10);
  const W = new Uint32Array(2);

  // round 1..23 (DeepSeekHashV1: round 0 DILEWATI)
  for (let ir = 1; ir < 24; ir++) {
    // ---- theta ----
    for (let x = 0; x < 5; x++) {
      const a = 2 * x, b = (x + 5) * 2, c = (x + 10) * 2, d = (x + 15) * 2, e = (x + 20) * 2;
      C[a] = st[a] ^ st[b] ^ st[c] ^ st[d] ^ st[e];
      C[a + 1] = st[a + 1] ^ st[b + 1] ^ st[c + 1] ^ st[d + 1] ^ st[e + 1];
    }
    for (let x = 0; x < 5; x++) {
      const l = (x + 1) % 5;
      W[0] = C[l * 2]; W[1] = C[l * 2 + 1];
      const o = W[0], f = W[1];
      W[0] = (o << 1) | (f >>> 31);
      W[1] = (f << 1) | (o >>> 31);
      const m = (x + 4) % 5;
      D[x * 2] = C[m * 2] ^ W[0];
      D[x * 2 + 1] = C[m * 2 + 1] ^ W[1];
      for (let y = 0; y < 25; y += 5) {
        st[(y + x) * 2] ^= D[x * 2];
        st[(y + x) * 2 + 1] ^= D[x * 2 + 1];
      }
    }
    // ---- rho + pi ----
    // W = lane A[1]
    W[0] = st[2]; W[1] = st[3];
    for (let i = 0; i < 24; i++) {
      const t = PI[i], a = RHO[i];
      // C = lane A[t]
      C[0] = st[t * 2]; C[1] = st[t * 2 + 1];
      const o = W[0], f = W[1];
      const u = 32 - a;
      const s = a < 32 ? 0 : 1;
      W[s] = (o << a) | (f >>> u);
      W[(s + 1) % 2] = (f << a) | (o >>> u);
      st[t * 2] = W[0]; st[t * 2 + 1] = W[1];
      W[0] = C[0]; W[1] = C[1];
    }
    // ---- chi ----
    for (let row = 0; row < 25; row += 5) {
      for (let n = 0; n < 5; n++) { C[n * 2] = st[(row + n) * 2]; C[n * 2 + 1] = st[(row + n) * 2 + 1]; }
      for (let n = 0; n < 5; n++) {
        const i = (row + n) * 2, o = ((n + 1) % 5) * 2, f = ((n + 2) % 5) * 2;
        st[i] ^= ~C[o] & C[f];
        st[i + 1] ^= ~C[o + 1] & C[f + 1];
      }
    }
    // ---- iota ----
    st[0] ^= RC[ir * 2];
    st[1] ^= RC[ir * 2 + 1];
  }
}

function xorBlock(state, block, off) {
  for (let r = off; r < off + RATE; r += 8) {
    const n = (r - off) / 4 + ((off / 8) * 2); // selalu dipanggil dengan off kelipatan RATE
    state[n] ^= block[r + 7] << 24 | block[r + 6] << 16 | block[r + 5] << 8 | block[r + 4];
    state[n + 1] ^= block[r + 3] << 24 | block[r + 2] << 16 | block[r + 1] << 8 | block[r];
  }
}

/** Hash pesan UTF-8 -> hex 64 char (DeepSeekHashV1 / SHA3-256 minus round-0) */
export function dsHashHex(msg) {
  const data = Buffer.from(msg, 'utf8');
  const state = new Uint32Array(50);
  const queue = new Uint8Array(RATE);
  let qOff = 0;

  let i = 0;
  while (data.length - i >= RATE) {
    xorBlock(state, data, i);
    keccakF(state);
    i += RATE;
  }
  for (; i < data.length; i++) {
    queue[qOff++] = data[i];
  }

  // squeeze: padding SHA3-style (byte domain 6, 0x80 di akhir blok)
  queue.fill(0, qOff);
  queue[qOff] |= 6;
  queue[RATE - 1] |= 128;
  xorBlock(state, queue, 0);
  keccakF(state);

  // ekstrak 32 byte pertama (LE per lane: lo dulu)
  const out = Buffer.alloc(OUT_LEN);
  for (let r = 0; r < OUT_LEN; r += 8) {
    const n = (r / 8) * 2;
    out[r] = state[n + 1]; out[r + 1] = state[n + 1] >>> 8; out[r + 2] = state[n + 1] >>> 16; out[r + 3] = state[n + 1] >>> 24;
    out[r + 4] = state[n]; out[r + 5] = state[n] >>> 8; out[r + 6] = state[n] >>> 16; out[r + 7] = state[n] >>> 24;
  }
  return out.toString('hex');
}

// ---------- verifikasi terhadap data hasil sniffing ----------
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('verify-deepseek-hash.mjs')) {
  const ch = {
    algorithm: 'DeepSeekHashV1',
    challenge: '61670a184ab11fdc53040e04b476e1973e64533068d257f2e2de4309ecb2e29d',
    salt: '9e5a429305859c7156ed',
    difficulty: 144000,
    expire_at: 1787409181430,
  };
  const prefix = `${ch.salt}_${ch.expire_at}_`;

  console.log('[*] sanity: dsHash("abc")          =', dsHashHex('abc'));
  console.log('             crypto sha3-256("abc") =', createHash('sha3-256').update('abc').digest('hex'), '(harus beda)');
  console.log('[*] sanity: dsHash("")            =', dsHashHex(''));

  const t0 = Date.now();
  let answer = null;
  for (let i = 0; i < ch.difficulty; i++) {
    if (dsHashHex(prefix + String(i)) === ch.challenge) { answer = i; break; }
  }
  const dt = Date.now() - t0;
  console.log(`[*] solve: answer=${answer} (${dt}ms, expect 103730)`);
  console.log(answer === 103730 ? '[✓] ALGORITMA TERVERIFIKASI' : '[x] BELUM COCOK');
}

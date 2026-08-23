/**
 * DeepSeekHashV1 PoW solver - hasil reverse engineering worker chat.deepseek.com
 *
 * Permutasi Keccak-f[1600] HANYA round 1..23 (round 0 dilewati).
 * Layout state: Uint32Array(50), lane k -> [2k]=hi32, [2k+1]=lo32.
 * Rate 136 byte (capacity 256), padding SHA3-style (domain 0x06, terminator 0x80).
 */

const RC = new Uint32Array([
  0, 1, 0, 32898, 0x80000000, 32906, 0x80000000, 0x80008000, 0, 32907,
  0, 0x80000001, 0x80000000, 0x80008081, 0x80000000, 32777, 0, 138, 0, 136,
  0, 0x80008009, 0, 0x8000000a, 0, 0x8000808b, 0x80000000, 139, 0x80000000, 32905,
  0x80000000, 32771, 0x80000000, 32770, 0x80000000, 128, 0, 32778, 0x80000000, 0x8000000a,
  0x80000000, 0x80008081, 0x80000000, 32896, 0, 0x80000001, 0x80000000, 0x80008008,
]);

const PI = [10, 7, 11, 17, 18, 3, 5, 16, 8, 21, 24, 4, 15, 23, 19, 13, 12, 2, 20, 14, 22, 9, 6, 1];
const RHO = [1, 3, 6, 10, 15, 21, 28, 36, 45, 55, 2, 14, 27, 41, 56, 8, 25, 43, 62, 18, 39, 61, 20, 44];

const RATE = 136;
const OUT_LEN = 32;

function keccakF(st) {
  const C = new Uint32Array(10);
  const D = new Uint32Array(10);
  const W = new Uint32Array(2);
  for (let ir = 1; ir < 24; ir++) {
    for (let x = 0; x < 5; x++) {
      const a = 2 * x, b = (x + 5) * 2, c = (x + 10) * 2, d = (x + 15) * 2, e = (x + 20) * 2;
      C[a] = st[a] ^ st[b] ^ st[c] ^ st[d] ^ st[e];
      C[a + 1] = st[a + 1] ^ st[b + 1] ^ st[c + 1] ^ st[d + 1] ^ st[e + 1];
    }
    for (let x = 0; x < 5; x++) {
      const l = ((x + 1) % 5) * 2;
      W[0] = C[l]; W[1] = C[l + 1];
      const o = W[0], f = W[1];
      W[0] = (o << 1) | (f >>> 31);
      W[1] = (f << 1) | (o >>> 31);
      const m = ((x + 4) % 5) * 2;
      D[x * 2] = C[m] ^ W[0];
      D[x * 2 + 1] = C[m + 1] ^ W[1];
      for (let y = 0; y < 50; y += 10) {
        st[y + x * 2] ^= D[x * 2];
        st[y + x * 2 + 1] ^= D[x * 2 + 1];
      }
    }
    W[0] = st[2]; W[1] = st[3];
    for (let i = 0; i < 24; i++) {
      const t = PI[i] * 2, a = RHO[i];
      C[0] = st[t]; C[1] = st[t + 1];
      const o = W[0], f = W[1], u = 32 - a, s = a < 32 ? 0 : 1;
      W[s] = (o << a) | (f >>> u);
      W[(s + 1) % 2] = (f << a) | (o >>> u);
      st[t] = W[0]; st[t + 1] = W[1];
      W[0] = C[0]; W[1] = C[1];
    }
    for (let row = 0; row < 50; row += 10) {
      for (let n = 0; n < 10; n += 2) { C[n] = st[row + n]; C[n + 1] = st[row + n + 1]; }
      for (let n = 0; n < 5; n++) {
        const i = row + n * 2, o = ((n + 1) % 5) * 2, f = ((n + 2) % 5) * 2;
        st[i] ^= ~C[o] & C[f];
        st[i + 1] ^= ~C[o + 1] & C[f + 1];
      }
    }
    st[0] ^= RC[ir * 2];
    st[1] ^= RC[ir * 2 + 1];
  }
}

function xorBytes(state, bytes, from, to) {
  for (let r = from; r < to; r += 8) {
    const n = (r / 4) & ~1;
    state[n] ^= bytes[r + 7] << 24 | bytes[r + 6] << 16 | bytes[r + 5] << 8 | bytes[r + 4];
    state[n + 1] ^= bytes[r + 3] << 24 | bytes[r + 2] << 16 | bytes[r + 1] << 8 | bytes[r];
  }
}

/** Hash satu pesan UTF-8 -> Uint8Array(32) */
export function dsHash(msg) {
  const data = Buffer.from(msg, 'utf8');
  const state = new Uint32Array(50);
  const queue = new Uint8Array(RATE);
  let qOff = 0;

  let i = 0;
  while (data.length - i >= RATE) {
    xorBytes(state, data, i, i + RATE);
    keccakF(state);
    i += RATE;
  }
  for (; i < data.length; i++) queue[qOff++] = data[i];

  queue.fill(0, qOff);
  queue[qOff] |= 6;
  queue[RATE - 1] |= 128;
  xorBytes(state, queue, 0, RATE);
  keccakF(state);

  const out = new Uint8Array(OUT_LEN);
  for (let r = 0; r < OUT_LEN; r += 8) {
    const n = (r / 8) * 2;
    out[r] = state[n + 1]; out[r + 1] = state[n + 1] >>> 8; out[r + 2] = state[n + 1] >>> 16; out[r + 3] = state[n + 1] >>> 24;
    out[r + 4] = state[n]; out[r + 5] = state[n] >>> 8; out[r + 6] = state[n] >>> 16; out[r + 7] = state[n] >>> 24;
  }
  return out;
}

export function dsHashHex(msg) {
  return Buffer.from(dsHash(msg)).toString('hex');
}

/**
 * Solver teroptimasi: absorb prefix sekali, tiap nonce cukup copy state+queue
 * lalu absorb digit angka saja (teknik yang sama dengan sponge.copy() situs asli).
 */
function solveRange(prefixStr, challengeHex, start, end, onProgress) {
  const chalTarget = Buffer.from(challengeHex, 'hex');
  const prefix = Buffer.from(prefixStr, 'utf8');

  // state dasar dengan prefix sudah diabsorb
  const baseState = new Uint32Array(50);
  let bqOff = 0;
  let i = 0;
  while (prefix.length - i >= RATE) {
    xorBytes(baseState, prefix, i, i + RATE);
    keccakF(baseState);
    i += RATE;
  }
  const baseQueue = new Uint8Array(RATE);
  for (; i < prefix.length; i++) baseQueue[bqOff++] = prefix[i];

  const state = new Uint32Array(50);
  const queue = new Uint8Array(RATE);

  for (let nonce = start; nonce < end; nonce++) {
    state.set(baseState);
    queue.set(baseQueue);
    let qOff = bqOff;

    const digits = String(nonce);
    for (let d = 0; d < digits.length; d++) queue[qOff++] = digits.charCodeAt(d);

    queue.fill(0, qOff);
    queue[qOff] |= 6;
    queue[RATE - 1] |= 128;
    xorBytes(state, queue, 0, RATE);
    keccakF(state);

    // bandingkan digest byte langsung (tanpa alokasi hex)
    let ok = true;
    for (let b = 0; b < 32; b += 8) {
      const n = (b / 8) * 2;
      if (state[n + 1] !== chalTarget.readUInt32LE(b)) { ok = false; break; }
      if (state[n] !== chalTarget.readUInt32LE(b + 4)) { ok = false; break; }
    }
    if (ok) return nonce;
    if (onProgress && (nonce & 16383) === 0) onProgress(nonce);
  }
  return null;
}

/**
 * Selesaikan challenge DeepSeekHashV1.
 * @param {{algorithm:string,challenge:string,salt:string,difficulty:number,expire_at:number,target_path:string}} challenge
 * @returns {number} nonce
 */
export function solvePow(challenge) {
  if (challenge.algorithm !== 'DeepSeekHashV1') {
    throw new Error(`Unsupported algorithm: ${challenge.algorithm}`);
  }
  const prefix = `${challenge.salt}_${challenge.expire_at}_`;
  const answer = solveRange(prefix, challenge.challenge, 0, challenge.difficulty);
  if (answer === null) throw new Error('No solution found');
  return answer;
}

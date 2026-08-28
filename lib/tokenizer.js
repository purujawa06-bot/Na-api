/**
 * Tokenizer berbasis js-tiktoken (BPE) untuk penghitungan token usage yang akurat.
 * Encoding o200k_base (OpenAI) — mendekati tokenizer GPT & LLaMA-family.
 *
 * js-tiktoken v1 bersifat ESM & `getEncoding()` sinkron, jadi aman untuk
 * runtime nodejs maupun edge. Instance encoding dibuat LAZY & di-cache agar
 * tidak memuat ulang data ranks tiap panggilan.
 */
import { getEncoding } from 'js-tiktoken';

let encoder = null;

function getEncoder() {
  if (!encoder) encoder = getEncoding('o200k_base');
  return encoder;
}

/**
 * Hitung jumlah token sebuah teks memakai tokenizer BPE asli.
 * @param {string} [text]
 * @returns {number} jumlah token (0 untuk teks kosong/undefined)
 */
export function countTokens(text) {
  if (!text) return 0;
  return getEncoder().encode(text).length;
}

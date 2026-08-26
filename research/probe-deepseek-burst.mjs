/**
 * Verifikasi fix PoW: 4 request streamCompletion beruntun, semua harus menghasilkan teks.
 *   node scripts/probe-deepseek-burst.mjs
 */
import { streamCompletion } from '../lib/deepseek-web.js';

for (let i = 1; i <= 4; i++) {
  const t0 = Date.now();
  let chars = 0;
  try {
    for await (const d of streamCompletion({ prompt: 'Sebutkan 2 warna. Jawab sangat singkat.' })) {
      if (d.type === 'content') chars += d.text.length;
    }
    console.log(`#${i} ${Date.now() - t0}ms content_chars=${chars}${chars === 0 ? '  << KOSONG!' : ''}`);
  } catch (err) {
    console.log(`#${i} ERROR: ${err.message}`);
  }
}

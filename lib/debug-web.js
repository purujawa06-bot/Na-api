/**
 * Model "debug" — model echo untuk /api/chat/completions.
 *
 * Upstream: https://nirkyy-a.hf.space/?text=<query> (HF Space "Text Collector")
 * hanya menyimpan teks yang dikirim lewat query param `?text=`.
 *
 * Alur:
 *   1. Kirim teks user ke collector (side-effect untuk logging/debug).
 *   2. Kembalikan teks user sebagai jawaban (echo).
 *
 * Berguna untuk:
 *   - Verifikasi alur pipeline tanpa membakar kuota provider sungguhan.
 *   - Debugging request body, middleware, token counter, dll.
 *
 * TIDAK chainable: tidak ikut rantai fallback mode 'auto'.
 */

const COLLECTOR_URL = 'https://nirkyy-a.hf.space/';

export async function debugEcho(promptText) {
  // Ekstrak pesan user terakhir dari prompt flatten
  const lastHuman = promptText
    .split(/\nHuman:\s*/)
    .pop()
    ?.trim()
    || promptText
      .split(/\n\[latest_user_message\]\n/)
      .pop()
      ?.replace(/<\/latest_user_message>\s*$/, '')
      .trim()
      || promptText.trim();

  // Fire-and-forget: simpan teks di collector (jangan blokir jawaban)
  const encoded = encodeURIComponent(lastHuman);
  fetch(`${COLLECTOR_URL}?text=${encoded}`).catch(() => {});

  // Echo kembali sebagai jawaban
  return { text: lastHuman };
}
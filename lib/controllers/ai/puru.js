/**
 * @title Puru AI (OpenAI-Compatible Proxy)
 * @summary Transparent proxy ke Hollo ISA OpenAI-compatible API — model wajib "puru".
 * @description Transparent proxy ke **Hollo ISA** (`/v1/chat/completions`). Parameter OpenAI-compatible (messages, stream, max_tokens, temperature, dll.) diteruskan. Response adalah raw OpenAI-compatible JSON (non-streaming) atau SSE (streaming). Tidak memerlukan API key dari client — proxy inject key internal. **Model akan selalu dipaksa menjadi "puru"**, apapun yang dikirim client.
 * @method POST
 * @path /api/ai/puru
 * @response json
 * @param {string} body.model - Model AI. Wajib diisi "puru".
 * @param {array} body.messages - Array pesan OpenAI-compatible.
 * @param {boolean} [body.stream] - Aktifkan SSE streaming.
 * @example
 * async function chat() {
 *   const response = await fetch('/api/ai/puru', {
 *     method: 'POST',
 *     headers: { 'Content-Type': 'application/json' },
 *     body: JSON.stringify({
 *       "model": "puru",
 *       "messages": [
 *         { "role": "user", "content": "Halo, apa kabar?" }
 *       ],
 *       "stream": false
 *     })
 *   });
 *   const data = await response.json();
 *   console.log(data);
 * }
 * @guide
 * Endpoint ini khusus untuk agent coding / platform yang mendukung OpenAI-compatible.
 * Cocok untuk Roo Code, Continue.dev, atau platform lain dengan konfigurasi kustom OpenAI endpoint.
 *
 * ─────────────────────────────────────────────
 *  KONFIGURASI PADA ROO CODE / PLATFORM AGENT
 * ─────────────────────────────────────────────
 *
 *  Provider: OpenAI Compatible
 *  Base URL: https://na-api.vercel.app/api/ai/puru
 *  Model ID: puru
 *  API Key: isi bebas (contoh: "sk-xxxxxxxx")
 *
 *  Catatan:
 *  • Model harus diisi "puru".
 *  • API Key bisa diisi ngasal karena proxy inject key internal.
 *
 * ─────────────────────────────────────────────
 *  CONTOH CURL
 * ─────────────────────────────────────────────
 *
 *  === NON-STREAMING ===
 *
 *  curl -X POST "https://na-api.vercel.app/api/ai/puru" \
 *    -H "Content-Type: application/json" \
 *    -d '{
 *      "model": "puru",
 *      "messages": [
 *        { "role": "user", "content": "Halo, apa kabar?" }
 *      ]
 *    }'
 *
 *  === STREAMING ===
 *
 *  curl -X POST "https://na-api.vercel.app/api/ai/puru" \
 *    -H "Content-Type: application/json" \
 *    -d '{
 *      "model": "puru",
 *      "messages": [
 *        { "role": "user", "content": "Ceritakan tentang dirimu" }
 *      ],
 *      "stream": true
 *    }'
 *
 * ─────────────────────────────────────────────
 *  CONTOH INTEGRASI Roo Code (roocode.json)
 * ─────────────────────────────────────────────
 *
 *  {
 *    "apiProvider": "openai",
 *    "openAiBaseUrl": "https://na-api.vercel.app/api/ai/puru",
 *    "openAiModel": "puru",
 *    "openAiApiKey": "sk-xxxxxxxx"
 *  }
 */
const puruController = async (req) => {
    // Proxy handling done directly in route.js
    // Controller exists only for JSDoc documentation generation
    return req.body;
};

module.exports = puruController;
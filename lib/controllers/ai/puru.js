/**
 * @title Puru AI (OpenAI-Compatible Proxy)
 * @summary Transparent proxy ke Hollo ISA OpenAI-compatible API.
 * @description Transparent proxy ke **Hollo ISA** (`/v1/chat/completions`). Semua header, body, dan parameter OpenAI-compatible (model, messages, stream, max_tokens, temperature, dll.) diteruskan langsung tanpa modifikasi. Response adalah raw OpenAI-compatible JSON (non-streaming) atau SSE (streaming). Tidak memerlukan API key dari client — proxy inject key internal.
 * @method POST
 * @path /api/ai/puru
 * @response json
 * @param {Array<{role:string,content:string}>} body.messages - Array pesan format OpenAI `[{role, content}]`.
 * @param {string} [body.model] - Model ID (default: `"puru"`).
 * @param {boolean} [body.stream] - `true` untuk SSE streaming, `false` (default) untuk response langsung.
 * @param {number} [body.max_tokens] - Maksimal token response.
 * @param {number} [body.temperature] - Sampling temperature (0-2).
 * @param {...any} [body.*] - Parameter OpenAI-compatible lainnya diteruskan langsung.
 * @example
 * // === NON-STREAMING ===
 * async function chatPuru() {
 *   const res = await fetch('/api/ai/puru', {
 *     method: 'POST',
 *     headers: { 'Content-Type': 'application/json' },
 *     body: JSON.stringify({
 *       "model": "puru",
 *       "messages": [{ "role": "user", "content": "Halo!" }]
 *     })
 *   });
 *   const data = await res.json();
 *   // Raw OpenAI response: { id, object, choices: [{message: {role, content}}], ... }
 *   console.log(data.choices[0].message.content);
 * }
 *
 * // === STREAMING ===
 * async function chatPuruStream() {
 *   const res = await fetch('/api/ai/puru', {
 *     method: 'POST',
 *     headers: { 'Content-Type': 'application/json' },
 *     body: JSON.stringify({
 *       "messages": [{ "role": "user", "content": "Halo!" }],
 *       "stream": true
 *     })
 *   });
 *   const reader = res.body.getReader();
 *   // SSE: data: {"choices":[{"delta":{"content":"..."}}]}
 * }
 */
const puruController = async (req) => {
    // Proxy handling done directly in route.js
    // Controller exists only for JSDoc documentation generation
    return req.body;
};

module.exports = puruController;

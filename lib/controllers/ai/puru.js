/**
 * @title Puru AI (OpenAI-Compatible)
 * @summary Chat dengan model Puru via endpoint OpenAI-compatible.
 * @description Melakukan percakapan dengan model AI **Puru** menggunakan API yang kompatibel dengan OpenAI (`/v1/chat/completions`). Mendukung **non-streaming** (response langsung) maupun **streaming** via SSE. Parameter mengikuti format OpenAI: `messages` sebagai array of objects `{role, content}`.
 * @method POST
 * @path /api/ai/puru
 * @response json
 * @param {string|Array} body.messages - Pesan untuk AI. Bisa string langsung atau array `[{role, content}]` seperti format OpenAI.
 * @param {boolean} [body.stream] - `true` untuk streaming SSE (Server-Sent Events), `false` (default) untuk response langsung.
 * @param {number} [body.max_tokens] - Maksimal token response (default: 2048).
 * @param {number} [body.temperature] - Kreativitas sampling (default: 0.7, range 0-2).
 * @example
 * // === NON-STREAMING ===
 * async function chatPuru() {
 *   const res = await fetch('/api/ai/puru', {
 *     method: 'POST',
 *     headers: { 'Content-Type': 'application/json' },
 *     body: JSON.stringify({
 *       "messages": [{ "role": "user", "content": "Halo, siapa kamu?" }],
 *       "temperature": 0.9
 *     })
 *   });
 *   const data = await res.json();
 *   console.log(data);
 *   // Output:
 *   // {
 *   //   "success": true,
 *   //   "author": "PuruBoy",
 *   //   "result": "Halo! Aku Puru, asisten AI buatan PuruBoy."
 *   // }
 * }
 * 
 * // === STREAMING SSE ===
 * async function chatPuruStream() {
 *   const response = await fetch('/api/ai/puru', {
 *     method: 'POST',
 *     headers: { 'Content-Type': 'application/json' },
 *     body: JSON.stringify({
 *       "messages": "Ceritakan dongeng singkat",
 *       "stream": true
 *     })
 *   });
 * 
 *   const reader = response.body.getReader();
 *   const decoder = new TextDecoder();
 * 
 *   while (true) {
 *     const { done, value } = await reader.read();
 *     if (done) break;
 *     const text = decoder.decode(value);
 *     // Format: data: {"type":"content","content":"..."}
 *     console.log(text);
 *   }
 * }
 * 
 * // === MULTI-TURN CONVERSATION ===
 * async function chatMultiTurn() {
 *   const res = await fetch('/api/ai/puru', {
 *     method: 'POST',
 *     headers: { 'Content-Type': 'application/json' },
 *     body: JSON.stringify({
 *       "messages": [
 *         { "role": "system", "content": "Kamu adalah asisten yang ramah" },
 *         { "role": "user", "content": "Apa ibukota Indonesia?" },
 *         { "role": "assistant", "content": "Ibukota Indonesia adalah Nusantara." },
 *         { "role": "user", "content": "Siapa presiden pertamanya?" }
 *       ]
 *     })
 *   });
 *   const data = await res.json();
 *   console.log(data);
 * }
 * 
 * // === SHORT STRING PROMPT ===
 * async function chatSimple() {
 *   const res = await fetch('/api/ai/puru', {
 *     method: 'POST',
 *     headers: { 'Content-Type': 'application/json' },
 *     body: JSON.stringify({ "messages": "1+1 berapa?" })
 *   });
 *   const data = await res.json();
 *   console.log(data.result);
 * }
 */
const { chatCompletion } = require('../../puru');

const puruController = async (req) => {
    const { messages, stream, max_tokens, temperature } = req.body;

    if (!messages) {
        throw new Error("Parameter 'messages' wajib diisi. Bisa string atau array [{role, content}].");
    }

    if (stream) {
        // Streaming — handled by route directly
        return { stream: true, messages, max_tokens, temperature };
    }

    const result = await chatCompletion(messages, {
        stream: false,
        max_tokens: max_tokens || 2048,
        temperature: temperature || 0.7,
    });

    return {
        success: true,
        author: 'PuruBoy',
        result,
    };
};

module.exports = puruController;

/**
 * @title Puru AI (OpenAI-Compatible Proxy)
 * @summary Transparent proxy ke Hollo ISA OpenAI-compatible API.
 * @description Transparent proxy ke **Hollo ISA** (`/v1/chat/completions`). Semua header, body, dan parameter OpenAI-compatible (model, messages, stream, max_tokens, temperature, dll.) diteruskan langsung tanpa modifikasi. Response adalah raw OpenAI-compatible JSON (non-streaming) atau SSE (streaming). Tidak memerlukan API key dari client — proxy inject key internal.
 * @method POST
 * @path /api/ai/puru
 * @response json
 * @guide
 * Endpoint ini khusus untuk agent coding / platform yang mendukung OpenAI-compatible.
 * Cocok untuk Roo Code, Continue.dev, atau platform lain dengan konfigurasi kustom OpenAI endpoint.
 *
 * ─────────────────────────────────────────────
 *  KONFIGURASI PADA ROO CODE / PLATFORM AGENT
 * ─────────────────────────────────────────────
 *
 *  Provider: OpenAI Compatible
 *  Base URL: https://na-api.vercel.app/api/ai/puru/v1
 *  Model ID: isi bebas (contoh: "gpt-4o", "claude-3", dll.)
 *  API Key: isi bebas (contoh: "sk-xxxxxxxx")
 *
 *  Catatan:
 *  • Model ID & API Key bisa diisi ngasal karena proxy sudah otomatis
 *    meng-inject model ID dan API Key yang benar.
 *  • Semua request akan tetap diproses oleh model Hollo ISA bawaan.
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
 *      "model": "gpt-4o",
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
 *      "model": "claude-3",
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
 *    "openAiBaseUrl": "https://na-api.vercel.app/api/ai/puru/v1",
 *    "openAiModel": "gpt-4o",
 *    "openAiApiKey": "sk-xxxxxxxx"
 *  }
 */
const puruController = async (req) => {
    // Proxy handling done directly in route.js
    // Controller exists only for JSDoc documentation generation
    return req.body;
};

module.exports = puruController;
/**
 * @title Gemini AI V3
 * @summary Chat via Google Gemini (Hybrid V2+V1 Fallback) — format payload standar Gemini API.
 * @description Menerima format payload standar Google Gemini API dan mengembalikan response JSON murni dari Gemini SDK. Menggabungkan metode V2 (BatchExecute) dan V1 (StreamGenerate) dengan fallback otomatis. Maksimal 3 kali percobaan. Response adalah data ASLI dari Gemini (raw JSON SDK), bukan wrapper buatan.
 * @method POST
 * @path /api/ai/gemini-v3
 * @response json
 * @param {Array} body.contents - Array of content objects (role + parts). Riwayat percakapan. Minimal 1 item.
 * @param {Object} [body.systemInstruction] - System instruction untuk mengatur perilaku AI. Berisi `parts` array.
 * @param {Object} [body.generationConfig] - Konfigurasi generation (temperature, topP, topK, dll).
 * @guide
 * ## Format Payload (RAW — Standar Gemini API)
 * 
 * Kirim payload **RAW JSON** langsung ke endpoint. Contoh siap eksekusi:
 * 
 * ### 🔹 Single-turn (pertanyaan tunggal)
 * 
 * ```bash
 * curl -X POST "https://puruboy-api.vercel.app/api/ai/gemini-v3" \
 *   -H "Content-Type: application/json" \
 *   -d '{
 *     "contents": [
 *       {
 *         "role": "user",
 *         "parts": [
 *           { "text": "Halo! Siapa presiden Indonesia pertama?" }
 *         ]
 *       }
 *     ],
 *     "systemInstruction": {
 *       "parts": [
 *         { "text": "Kamu adalah asisten AI yang cerdas, ramah, dan menjawab dengan singkat." }
 *       ]
 *     },
 *     "generationConfig": {
 *       "temperature": 0.7,
 *       "topP": 0.9,
 *       "topK": 40
 *     }
 *   }'
 * ```
 * 
 * ### 🔹 Multi-turn (percakapan dengan konteks)
 * 
 * ```bash
 * curl -X POST "https://puruboy-api.vercel.app/api/ai/gemini-v3" \
 *   -H "Content-Type: application/json" \
 *   -d '{
 *     "contents": [
 *       { "role": "user", "parts": [{ "text": "Halo, nama saya Budi" }] },
 *       { "role": "model", "parts": [{ "text": "Halo Budi! Ada yang bisa saya bantu?" }] },
 *       { "role": "user", "parts": [{ "text": "Siapa nama saya?" }] }
 *     ],
 *     "generationConfig": {
 *       "temperature": 0.3
 *     }
 *   }'
 * ```
 * 
 * ---
 * 
 * ## ⚡ RAW Internal RPC Payload (batchexecute)
 * 
 * Di belakang layar, endpoint ini mengirim request ke Google Gemini via protokol **batchexecute** dengan format RAW berikut:
 * 
 * ```
 * POST https://gemini.google.com/_/BardChatUi/data/batchexecute
 * Content-Type: application/x-www-form-urlencoded;charset=UTF-8
 * 
 * f.req=[[["q4uTj","[null,\"{\\\"contents\\\":[...]}\",1,\"caea8d35955a\"]",null,"generic"]]]&at=
 * ```
 * 
 ### Struktur RPC Array:
 * 
 * | Level | Data | Keterangan |
 * |-------|------|------------|
 * | 1 | `f.req` | Array RPC eksternal (`[[["q4uTj", ...]]]`) |
 * | 2 | `q4uTj` | Method identifier untuk Gemini chat |
 * | 3 | Inner array | `[null, stringifiedRequestBody, 1, "caea8d35955a"]` |
 * | 4 | `at` | Token `SNlM0e` (kosong/tidak diperlukan) |
 * 
 * ---
 * 
 * ## Response Format (RAW Gemini SDK)
 * 
 * Response adalah **JSON murni dari Gemini SDK** — bukan wrapper buatan. Contoh:
 * 
 * ```json
 * {
 *   "candidates": [
 *     {
 *       "content": {
 *         "parts": [
 *           { "text": "Presiden pertama Indonesia adalah Ir. Soekarno." }
 *         ],
 *         "role": "model"
 *       },
 *       "finishReason": "STOP",
 *       "index": 0,
 *       "safetyRatings": [
 *         { "category": "HARM_CATEGORY_HARASSMENT", "probability": "NEGLIGIBLE" },
 *         { "category": "HARM_CATEGORY_HATE_SPEECH", "probability": "NEGLIGIBLE" }
 *       ]
 *     }
 *   ],
 *   "usageMetadata": {
 *     "promptTokenCount": 15,
 *     "candidatesTokenCount": 25,
 *     "totalTokenCount": 40
 *   }
 * }
 * ```
 * 
 * ## Catatan Penting
 * 
 * - **Field `contents` wajib** diisi minimal 1 item dengan `role: "user"`.
 * - **Format sudah standar Gemini API** — bisa pakai SDK Google langsung.
 * - **Auto retry** 3x dengan fallback V2 → V1 → V2 jika salah satu metode gagal.
 * - **Tidak perlu API key** — gratis.
 * @example
 * # RAW Format — Langsung executable via curl:
 * curl -X POST "https://puruboy-api.vercel.app/api/ai/gemini-v3" \
 *   -H "Content-Type: application/json" \
 *   -d '{
 *     "contents": [
 *       {
 *         "role": "user",
 *         "parts": [
 *           { "text": "Halo! Siapa presiden Indonesia pertama?" }
 *         ]
 *       }
 *     ],
 *     "systemInstruction": {
 *       "parts": [
 *         { "text": "Kamu adalah asisten AI yang cerdas, ramah, dan menjawab dengan singkat." }
 *       ]
 *     },
 *     "generationConfig": {
 *       "temperature": 0.7,
 *       "topP": 0.9,
 *       "topK": 40
 *     }
 *   }'
 */
const { chat } = require('../../geminiV3');

const geminiV3Controller = async (req) => {
    const { contents, systemInstruction, generationConfig } = req.body;

    if (!contents || !Array.isArray(contents) || contents.length === 0) {
        throw new Error("Parameter 'contents' wajib diisi dan harus berupa array.");
    }

    // Hasil chat berisi sdkResponse (full Gemini SDK JSON) dan rawResponses
    const result = await chat({ contents, systemInstruction, generationConfig });

    // Kembalikan langsung JSON murni Gemini SDK tanpa wrapper buatan
    // Ini adalah response asli dari Gemini API yang sudah diekstrak dari raw
    return result.sdkResponse;
};

module.exports = geminiV3Controller;
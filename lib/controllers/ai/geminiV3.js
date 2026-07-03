/**
 * @title Gemini AI V3
 * @summary Chat via Google Gemini (Hybrid V2+V1 Fallback) dengan format payload standar Gemini API.
 * @description Menerima format payload standar Google Gemini API (`contents`, `systemInstruction`, `generationConfig`) dan mengembalikan response JSON murni dari Gemini SDK. Menggabungkan metode V2 (BatchExecute) dan V1 (StreamGenerate) dengan fallback otomatis. Maksimal 3 kali percobaan.
 * @method POST
 * @path /api/ai/gemini-v3
 * @response json
 * @param {object} body.contents - Array of content objects, masing-masing memiliki `role` ("user" atau "model") dan `parts` (array of objects dengan `text`). Contoh: `[{"role": "user", "parts": [{"text": "Halo"}]}]`.
 * @param {object} [body.systemInstruction] - System instruction untuk mengatur perilaku AI. Contoh: `{"parts": [{"text": "Anda adalah asisten yang ramah"}]}`.
 * @param {object} [body.generationConfig] - Konfigurasi generation seperti temperature. Contoh: `{"temperature": 0.7}`.
 * @example
 * const response = await fetch('/api/ai/gemini-v3', {
 *   method: 'POST',
 *   headers: { 'Content-Type': 'application/json' },
 *   body: JSON.stringify({
 *     "contents": [
 *       {
 *         "role": "user",
 *         "parts": [{ "text": "Halo, siapa nama saya?" }]
 *       }
 *     ],
 *     "systemInstruction": {
 *       "parts": [{ "text": "Anda adalah asisten AI yang ramah dan cerdas." }]
 *     },
 *     "generationConfig": {
 *       "temperature": 0.7
 *     }
 *   })
 * });
 * 
 * const data = await response.json();
 * console.log(data);
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
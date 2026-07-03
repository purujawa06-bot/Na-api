/**
 * @title Gemini AI V3
 * @summary Chat via Google Gemini (Hybrid V2+V1 Fallback).
 * @description Menggabungkan metode V2 (BatchExecute) dan V1 (StreamGenerate) dengan fallback otomatis. Jika V2 gagal, otomatis beralih ke V1. Maksimal 3 kali percobaan. Mengembalikan JSON murni dari Gemini SDK yang diekstrak dari raw response.
 * @method POST
 * @path /api/ai/gemini-v3
 * @response json
 * @param {string} body.prompt - Pertanyaan yang ingin diajukan ke Gemini.
 * @example
 * async function chatGeminiV3() {
 *   const response = await fetch('/api/ai/gemini-v3', {
 *     method: 'POST',
 *     headers: { 'Content-Type': 'application/json' },
 *     body: JSON.stringify({ "prompt": "Halo Gemini!" })
 *   });
 * 
 *   const data = await response.json();
 *   console.log(data);
 * }
 */
const { chat } = require('../../geminiV3');

const geminiV3Controller = async (req) => {
    const { prompt } = req.body;

    if (!prompt) {
        throw new Error("Parameter 'prompt' wajib diisi.");
    }

    // Hasil chat berisi sdkResponse (full Gemini SDK JSON) dan rawResponses
    const result = await chat(prompt);

    // Kembalikan langsung JSON murni Gemini SDK tanpa wrapper buatan
    // Ini adalah response asli dari Gemini API yang sudah diekstrak dari raw
    return result.sdkResponse;
};

module.exports = geminiV3Controller;
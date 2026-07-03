/**
 * @title Gemini AI V3
 * @summary Chat via Google Gemini (Hybrid V2+V1 Fallback) dengan format payload standar Gemini API.
 * @description Menerima format payload standar Google Gemini API dan mengembalikan response JSON murni dari Gemini SDK. Menggabungkan metode V2 (BatchExecute) dan V1 (StreamGenerate) dengan fallback otomatis. Maksimal 3 kali percobaan.
 * @method POST
 * @path /api/ai/gemini-v3
 * @response json
 * @guide
 * ## Request Body (Standar Gemini API)
 * 
 * Endpoint ini menggunakan format payload **standar Google Gemini API**:
 * 
 * ```json
 * {
 *   "contents": [
 *     {
 *       "role": "user",
 *       "parts": [{ "text": "Pesan Anda di sini" }]
 *     }
 *   ],
 *   "systemInstruction": {
 *     "parts": [{ "text": "Instruksi sistem untuk AI" }]
 *   },
 *   "generationConfig": {
 *     "temperature": 0.7
 *   }
 * }
 * ```
 * 
 * ### Penjelasan Field
 * 
 * | Field | Tipe | Wajib | Deskripsi |
 * |-------|------|-------|-----------|
 * | `contents` | Array | ✅ | Riwayat percakapan. Setiap item punya `role` ("user"/"model") dan `parts` (array of `{text}`) |
 * | `systemInstruction` | Object | ❌ | Instruksi sistem untuk mengatur perilaku AI |
 * | `generationConfig` | Object | ❌ | Konfigurasi generation seperti `temperature` |
 * 
 * ### Contoh Multi-turn Conversation
 * 
 * Untuk percakapan multi-turn, tambahkan riwayat ke `contents`:
 * 
 * ```json
 * {
 *   "contents": [
 *     { "role": "user", "parts": [{ "text": "Halo, nama saya Budi" }] },
 *     { "role": "model", "parts": [{ "text": "Halo Budi! Ada yang bisa dibantu?" }] },
 *     { "role": "user", "parts": [{ "text": "Siapa nama saya?" }] }
 *   ],
 *   "systemInstruction": {
 *     "parts": [{ "text": "Anda adalah asisten yang ramah dan memiliki ingatan kuat." }]
 *   },
 *   "generationConfig": {
 *     "temperature": 0.5,
 *     "topP": 0.9,
 *     "topK": 40
 *   }
 * }
 * ```
 * 
 * ## Response
 * 
 * Response adalah **JSON murni dari Gemini SDK** (bukan wrapper buatan), contoh:
 * 
 * ```json
 * {
 *   "candidates": [{
 *     "content": {
 *       "parts": [{ "text": "Nama Anda adalah Budi!" }],
 *       "role": "model"
 *     },
 *     "finishReason": "STOP",
 *     "index": 0,
 *     "safetyRatings": [...]
 *   }],
 *   "usageMetadata": {
 *     "promptTokenCount": 25,
 *     "candidatesTokenCount": 10
 *   }
 * }
 * ```
 * @example
 * const response = await fetch('/api/ai/gemini-v3', {
 *   method: 'POST',
 *   headers: { 'Content-Type': 'application/json' },
 *   body: JSON.stringify({
 *     contents: [
 *       {
 *         role: "user",
 *         parts: [{ text: "Halo, siapa nama saya?" }]
 *       }
 *     ],
 *     systemInstruction: {
 *       parts: [{ text: "Anda adalah asisten AI yang ramah dan cerdas." }]
 *     },
 *     generationConfig: {
 *       temperature: 0.7
 *     }
 *   })
 * });
 * 
 * const data = await response.json();
 * console.log(data.candidates[0].content.parts[0].text);
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
/**
 * @title Gemini AI V2
 * @summary Chat via Google Gemini (BatchExecute).
 * @description Berinteraksi dengan Google Gemini menggunakan metode BatchExecute yang lebih stabil untuk pertanyaan tunggal.
 * @method POST
 * @path /api/ai/gemini-v2
 * @response json
 * @param {string} body.prompt - Pertanyaan yang ingin diajukan ke Gemini.
 * @example
 * async function chatGemini() {
 *   const response = await fetch('/api/ai/gemini-v2', {
 *     method: 'POST',
 *     headers: { 'Content-Type': 'application/json' },
 *     body: JSON.stringify({ "prompt": "Halo Gemini!" })
 *   });
 * 
 *   const data = await response.json();
 *   console.log(data);
 * }
 */
const { chat } = require('../../geminiV2');

const geminiV2Controller = async (req) => {
    const { prompt } = req.body;

    if (!prompt) {
        throw new Error("Parameter 'prompt' wajib diisi.");
    }

    const answer = await chat(prompt);

    return {
        success: true,
        author: 'Tiyanz',
        result: {
            answer: answer
        }
    };
};

module.exports = geminiV2Controller;
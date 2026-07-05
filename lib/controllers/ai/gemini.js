/**
 * @title Gemini AI Chat
 * @summary Chat via Google Gemini (Proxy).
 * @description Berinteraksi dengan Google Gemini menggunakan browser automation.
 * @method POST
 * @path /api/ai/gemini
 * @response json
 * @param {string} body.prompt - Pertanyaan yang ingin diajukan ke Gemini.
 * @example
 * async function chatGemini() {
 *   const response = await fetch('/api/ai/gemini', {
 *     method: 'POST',
 *     headers: { 'Content-Type': 'application/json' },
 *     body: JSON.stringify({ "prompt": "Halo Gemini!" })
 *   });
 * 
 *   const data = await response.json();
 *   console.log(data);
 * }
 */
const { askGemini } = require('../../gemini');

const geminiController = async (req) => {
    const { prompt } = req.body;

    if (!prompt) {
        throw new Error("Parameter 'prompt' wajib diisi.");
    }

    const answer = await askGemini(prompt);

    return {
        success: true,
        author: 'Tiyanz',
        result: {
            answer: answer
        }
    };
};

module.exports = geminiController;
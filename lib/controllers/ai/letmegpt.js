/**
 * @title LetMeGPT AI
 * @summary Chat AI via LetMeGPT.
 * @description Berinteraksi dengan model AI melalui layanan scraping LetMeGPT.
 * @method POST
 * @path /api/ai/letmegpt
 * @response json
 * @param {string} body.message - Pesan yang ingin diajukan ke AI.
 * @example
 * async function chat() {
 *   const res = await fetch('/api/ai/letmegpt', {
 *     method: 'POST',
 *     headers: { 'Content-Type': 'application/json' },
 *     body: JSON.stringify({ "message": "Siapa namamu?" })
 *   });
 *   const data = await res.json();
 *   console.log(data);
 * }
 */
const { askGPT } = require('../../letmegpt');

const letmegptController = async (req) => {
    const { message } = req.body;

    if (!message) {
        throw new Error("Parameter 'message' wajib diisi.");
    }

    const result = await askGPT(message);

    return {
        success: true,
        author: 'Tiyanz',
        result: result
    };
};

module.exports = letmegptController;
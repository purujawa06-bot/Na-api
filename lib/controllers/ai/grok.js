/**
 * @title Grok-4 Chat
 * @summary Chat AI Grok-4 Fast.
 * @description Berinteraksi dengan model Grok-4 Fast melalui ToolBaz. Model ini dikenal cepat dalam memberikan respons.
 * @method POST
 * @path /api/ai/grok
 * @response json
 * @param {string} body.message - Pesan yang ingin dikirim ke AI.
 * @example
 * async function chat() {
 *   try {
 *     const response = await fetch('/api/ai/grok', {
 *       method: 'POST',
 *       headers: { 'Content-Type': 'application/json' },
 *       body: JSON.stringify({ 
 *         "message": "Siapa pencipta bahasa pemrograman JavaScript?" 
 *       })
 *     });
 * 
 *     const data = await response.json();
 *     console.log(data);
 *   } catch (error) {
 *     console.error('Error:', error);
 *   }
 * }
 * 
 * chat();
 */
const { chatGrok } = require('../../grok');

const grokController = async (req) => {
    const { message } = req.body;

    if (!message) {
        throw new Error("Parameter 'message' wajib diisi.");
    }

    const result = await chatGrok(message);

    return {
        success: true,
        author: 'Tiyanz',
        result: result
    };
};

module.exports = grokController;
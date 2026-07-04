/**
 * @title Chat Espanyol
 * @summary Chat AI (ChatEspanyol).
 * @description Melakukan percakapan dengan AI dari ChatEspanyolGratis. Mendukung percakapan berkelanjutan dengan menyertakan `sessionId` dan `conversationUuid`.
 * @method POST
 * @path /api/ai/chatespanyol
 * @response json
 * @param {string} body.message - Pesan yang ingin dikirim ke AI.
 * @param {string} [body.sessionId] - ID sesi untuk menjaga konteks percakapan (opsional).
 * @param {string} [body.conversationUuid] - UUID percakapan (opsional).
 * @example
 * async function chat() {
 *   try {
 *     const response = await fetch('/api/ai/chatespanyol', {
 *       method: 'POST',
 *       headers: { 'Content-Type': 'application/json' },
 *       body: JSON.stringify({ 
 *         "message": "Halo Kawanku" 
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
const { bot } = require('../../chatespanyol');

const chatEspanyolController = async (req) => {
    const { message, sessionId, conversationUuid } = req.body;

    if (!message) {
        throw new Error("Parameter 'message' wajib diisi.");
    }

    const result = await bot.sendMessage(message, { sessionId, conversationUuid });

    return {
        success: true,
        author: 'Tiyanz',
        result: result
    };
};

module.exports = chatEspanyolController;
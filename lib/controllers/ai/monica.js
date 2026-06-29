/**
 * @title Monica AI Chat (Simplified)
 * @summary Chat AI Monica — cukup kirim prompt saja.
 * @description Endpoint chat Monica AI yang sudah disederhanakan.
 *              Hanya menerima prompt, sisanya otomatis.
 * @method POST
 * @path /api/ai/monica
 * @response json
 * @param {string} body.prompt - Pesan yang ingin dikirim ke AI (wajib).
 * @example
 * fetch('/api/ai/monica', {
 *   method: 'POST',
 *   headers: { 'Content-Type': 'application/json' },
 *   body: JSON.stringify({ "prompt": "Halo, apa kabar?" })
 * })
 */
const MonicaClient = require('../../monica');

// Default session from public gist (free tier)
const defaultSession = "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpYXQiOjE3ODI1NDkyNDAsImlzcyI6Im1vbmljYSIsInVzZXJfaWQiOjIwNDE2NDY3NywidXNlcl9uYW1lIjoiQW5hQm90IiwianRpIjoiZDM5NDg1MWE5NjE1NDhkMjg2M2M2MzkzNmJkYjI0N2QiLCJjbGllbnRfdHlwZSI6ImFuZHJvaWQifQ.Vzk4JXRP3QG1Eh2kTnL_A9cbAyosjkZGHfccc3KNxwA";

const monicaController = async (req) => {
    const { prompt } = req;

    if (!prompt) {
        throw new Error("Parameter 'prompt' wajib diisi.");
    }

    const client = new MonicaClient(defaultSession);

    const result = await client.chat(prompt);

    return {
        success: true,
        author: 'PuruBoy',
        result: result.content,
        follow_suggestions: result.followSuggestions,
        metadata: {
            finished: result.finished,
            raw_messages_count: result.rawMessages.length
        }
    };
};

module.exports = monicaController;

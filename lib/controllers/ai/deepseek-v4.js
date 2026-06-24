/**
 * @title DeepSeek V4 - Free AI Chat
 * @summary Chat AI gratis via deep-seek.ai (proxy OpenRouter).
 * @description Mengirim pesan ke DeepSeek AI secara gratis melalui deep-seek.ai. Mendukung model DeepSeek V4 Flash, R1, dan V3. Semua response menggunakan SSE (Server-Sent Events) dengan reasoning visible.
 * @method POST
 * @path /api/ai/deepseek/v4
 * @response json
 * @param {string} body.message - Pesan untuk AI (wajib).
 * @param {string} [body.model] - Model yang digunakan. (opsional)
 * @choice deepseek/deepseek-v4-flash - DeepSeek V4 Flash (Cepat & Efisien)
 * @choice deepseek/deepseek-r1 - DeepSeek R1 (Reasoning Mendalam)
 * @choice deepseek/deepseek-v3.2 - DeepSeek V3 (Balanced)
 * @param {array} [body.history] - Riwayat percakapan [{role, content}] (opsional)
 * @example
 * fetch('https://puruboy-api.vercel.app/api/ai/deepseek/v4', {
 *     method: 'POST',
 *     headers: { 'Content-Type': 'application/json' },
 *     body: JSON.stringify({
 *         message: 'Buatkan saya kalkulator sederhana di Python',
 *         model: 'deepseek/deepseek-v4-flash',
 *         history: []
 *     })
 * }).then(res => res.json()).then(console.log);
 */
const deepseekV4Controller = async (req) => {
    return { status: 'SSE Stream Endpoint' };
};

module.exports = deepseekV4Controller;

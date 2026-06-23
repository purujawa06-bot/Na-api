/**
 * @title DeepSeek V4 - Free AI Chat
 * @summary Chat AI gratis via deep-seek.ai (proxy OpenRouter).
 * @description Mengirim pesan ke DeepSeek AI secara gratis melalui deep-seek.ai. Mendukung model DeepSeek V4 Flash, R1, dan V3. Semua streaming menggunakan SSE (Server-Sent Events) dengan reasoning visible.
 * @method POST
 * @path /api/ai/deepseek/v4
 * @response json
 * @param {string} body.message - Pesan untuk AI (wajib).
 * @param {string} [body.model] - Model yang digunakan. (opsional)
 * @choice deepseek/deepseek-v4-flash - DeepSeek V4 Flash (Cepat & Efisien)
 * @choice deepseek/deepseek-r1 - DeepSeek R1 (Reasoning Mendalam)
 * @choice deepseek/deepseek-v3.2 - DeepSeek V3 (Balanced)
 */
const deepseekV4Controller = async (req) => {
    return { status: 'SSE Stream Endpoint' };
};

module.exports = deepseekV4Controller;

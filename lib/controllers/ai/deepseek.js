/**
 * @title DeepSeek R1 - AI Chat Legacy
 * @summary Chat dengan model DeepSeek R1 (legacy, via chatgot.io).
 * @description DeepSeek R1 dengan reasoning, menggunakan proxy chatgot.io. Streaming SSE, support reasoning + content.
 * @method POST
 * @path /api/ai/deepseek
 * @response stream
 * @param {string} body.prompt - Pertanyaan untuk AI (wajib).
 */
const deepseekController = async (req) => {
    return { status: 'SSE Stream Endpoint - Legacy' };
};

module.exports = deepseekController;

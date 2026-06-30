/**
 * @title ChatBotChatApp AI
 * @summary Chat AI via ChatBotChatApp.com.
 * @description Berinteraksi dengan model AI melalui layanan scraping ChatBotChatApp.
 * @method POST
 * @path /api/ai/chatbotchatapp
 * @response json
 * @param {string} body.message - Pesan yang ingin diajukan ke AI.
 * @param {string} [body.model] - Model AI (auto, gpt5, gpt_oss, deepseek_r1, deepseek_v3, qwen_35, mistral_large3, pixtral, devstral2).
 * @example
 * async function chat() {
 *   const res = await fetch('/api/ai/chatbotchatapp', {
 *     method: 'POST',
 *     headers: { 'Content-Type': 'application/json' },
 *     body: JSON.stringify({ "message": "Halo, apa kabar?" })
 *   });
 *   const data = await res.json();
 *   console.log(data);
 * }
 */
const { chat, MODELS } = require('../../chatbotchatapp');

const chatbotchatappController = async (req) => {
  const { message, model } = req.body;

  if (!message) {
    throw new Error("Parameter 'message' wajib diisi.");
  }

  const options = {};
  if (model && MODELS[model?.toUpperCase()?.replace(/-/g, '_')]) {
    options.model = MODELS[model.toUpperCase().replace(/-/g, '_')];
  }

  const result = await chat(message, options);

  return {
    success: true,
    author: 'PuruBoy',
    result: result
  };
};

module.exports = chatbotchatappController;

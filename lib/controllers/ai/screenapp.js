/**
 * @title ScreenApp Vision
 * @summary AI Image Analysis (Gemini).
 * @description Menganalisis gambar dan menjawab pertanyaan terkait gambar tersebut menggunakan model Gemini 2.0 Flash via ScreenApp proxy. Mendukung analisis visual yang detail.
 * @method POST
 * @path /api/ai/screenapp
 * @response json
 * @param {string} body.url - URL publik gambar yang akan dianalisis.
 * @param {string} body.question - Pertanyaan tentang gambar tersebut.
 * @example
 * async function askImage() {
 *   const res = await fetch('/api/ai/screenapp', {
 *     method: 'POST',
 *     headers: { 'Content-Type': 'application/json' },
 *     body: JSON.stringify({
 *       "url": "https://tiyanz-api.vercel.app/favicon.jpg",
 *       "question": "Jelaskan gambar ini dengan detail"
 *     })
 *   });
 *   const data = await res.json();
 *   console.log(data);
 * }
 */
const { chat } = require('../../screenapp');

const screenappController = async (req) => {
    const { url, question } = req.body;

    if (!url) {
        throw new Error("Parameter 'url' wajib diisi.");
    }
    if (!question) {
        throw new Error("Parameter 'question' wajib diisi.");
    }

    const answer = await chat(url, question);

    return {
        success: true,
        author: 'Tiyanz',
        result: {
            answer: answer
        }
    };
};

module.exports = screenappController;
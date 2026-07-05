/**
 * @title Audio to Text
 * @summary Transkripsi Audio ke Teks.
 * @description Mengonversi file suara/audio menjadi teks menggunakan teknologi AI Speech Recognition. Mendukung deteksi bahasa otomatis dan probabilitas akurasi.
 * @method POST
 * @path /api/tools/audio2text
 * @response json
 * @param {string} body.url - URL publik file audio (MP3/WAV/OGG).
 * @example
 * async function transcribe() {
 *   const res = await fetch('/api/tools/audio2text', {
 *     method: 'POST',
 *     headers: { 'Content-Type': 'application/json' },
 *     body: JSON.stringify({ "url": "https://puruboy-api.vercel.app/example.mp3" })
 *   });
 *   const data = await res.json();
 *   console.log(data.result.text);
 * }
 */
const { transcribe } = require('../../audio2text');

const audio2textController = async (req) => {
    const { url } = req.body;

    if (!url) {
        throw new Error("Parameter 'url' wajib diisi.");
    }

    const result = await transcribe(url);

    return {
        success: true,
        author: 'Tiyanz',
        result: result
    };
};

module.exports = audio2textController;
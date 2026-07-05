/**
 * @title Tsundere TTS
 * @summary AI Voice dengan gaya Tsundere.
 * @description Mengubah teks menjadi suara dengan nada Tsundere (ketus/malu-malu) menggunakan model Gemini TTS. Mengembalikan URL audio hasil proses.
 * @method POST
 * @path /api/ai/tsundere
 * @response json
 * @param {string} body.text - Teks yang akan diubah menjadi suara.
 * @example
 * async function speakTsundere() {
 *   const res = await fetch('/api/ai/tsundere', {
 *     method: 'POST',
 *     headers: { 'Content-Type': 'application/json' },
 *     body: JSON.stringify({ "text": "Bukannya aku menyukaimu ya, dasar baka!" })
 *   });
 *   const data = await res.json();
 *   console.log(data);
 * }
 */
const { generateTsundereTTS } = require('../../tsundere');
const { uploadToTmp } = require('../../uploader');

const tsundereController = async (req) => {
    const { text } = req.body;
    const origin = req.origin || '';

    if (!text) {
        throw new Error("Parameter 'text' wajib diisi.");
    }

    const audioBuffer = await generateTsundereTTS(text);
    const audioUrl = await uploadToTmp(audioBuffer, `tsundere-${Date.now()}.mp3`);

    return {
        success: true,
        author: 'Tiyanz',
        result: {
            text: text,
            audio: origin + audioUrl
        }
    };
};

module.exports = tsundereController;
/**
 * @title Dracin TTS
 * @summary AI Voice gaya Drama China (Dracin).
 * @description Mengubah teks menjadi suara dengan nada ala narator drama China. Mengembalikan URL audio hasil proses.
 * @method POST
 * @path /api/ai/dracin
 * @response json
 * @param {string} body.text - Teks yang akan diubah menjadi suara.
 * @param {boolean} [body.music] - Menggunakan musik latar? Default: true.
 * @param {number} [body.speed] - Kecepatan bicara (0.5 - 2.0). Default: 1.0.
 * @param {number} [body.volume] - Volume musik latar (0.1 - 1.0). Default: 0.3.
 * @example
 * async function speakDracin() {
 *   const res = await fetch('/api/ai/dracin', {
 *     method: 'POST',
 *     headers: { 'Content-Type': 'application/json' },
 *     body: JSON.stringify({ 
 *       "text": "Halo di sini soume",
 *       "music": true 
 *     })
 *   });
 *   const data = await res.json();
 *   console.log(data);
 * }
 */
const { generateDracinTTS } = require('../../dracin');
const { uploadToTmp } = require('../../uploader');

const dracinController = async (req) => {
    const { text, music, speed, volume } = req.body;
    const origin = req.origin || '';

    if (!text) {
        throw new Error("Parameter 'text' wajib diisi.");
    }

    const useBg = music !== undefined ? music : true;
    const voiceSpeed = speed || 1.0;
    const bgVol = volume || 0.3;

    const audioBuffer = await generateDracinTTS(text, voiceSpeed, useBg, bgVol);
    const audioUrl = await uploadToTmp(audioBuffer, `dracin-${Date.now()}.mp3`);

    return {
        success: true,
        author: 'Tiyanz',
        result: {
            text: text,
            audio: origin + audioUrl
        }
    };
};

module.exports = dracinController;
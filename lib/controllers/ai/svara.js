/**
 * @title Svara TTS
 * @summary Membuat audio dari teks (TTS) dengan Svara AI.
 * @description Menghasilkan file audio dari teks yang diberikan menggunakan berbagai pilihan suara. Credit: Daffa dari nbscript.
 * @method POST
 * @path /api/ai/svara
 * @response json
 * @param {string} body.text - Teks yang akan diubah menjadi suara (maksimal 300 karakter).
 * @param {string} body.voice - Nama suara yang akan digunakan. Contoh: 'bella', 'adam', 'arjun'.
 * @example
 * // Contoh penggunaan
 * async function generateSpeech() {
 *   try {
 *     const response = await fetch('/api/ai/svara', {
 *       method: 'POST',
 *       headers: { 'Content-Type': 'application/json' },
 *       body: JSON.stringify({ 
 *         "text": "Halo, selamat datang di NextA API.",
 *         "voice": "bella" 
 *       })
 *     });
 * 
 *     const data = await response.json();
 *     console.log(data);
 *   } catch (error) {
 *     console.error("Gagal melakukan permintaan:", error.message);
 *   }
 * }
 */
const { svara } = require('../../svara');

const svaraController = async (req) => {
    const { text, voice } = req.body;
    if (!text || !voice) {
        throw new Error("Parameter 'text' dan 'voice' wajib diisi.");
    }

    const result = await svara.generate(text, voice);

    if (result.success) {
        return { status: 'success', author: 'Tiyanz x Daffa (nbscript)', data: result };
    } else {
        throw new Error(result.result.error || 'Terjadi kesalahan saat menghasilkan suara.');
    }
};

module.exports = svaraController;
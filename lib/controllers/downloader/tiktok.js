/**
 * @title TikTok DL
 * @summary Mengunduh video TikTok tanpa watermark.
 * @description Memproses URL video TikTok dan mengembalikan informasi video beserta link unduhan langsung (tanpa watermark) dan link audio dalam format JSON.
 * @method POST
 * @path /api/downloader/tiktok
 * @response json
 * @param {string} body.url - URL lengkap dari video TikTok yang ingin diunduh.
 * @example
 * // Contoh penggunaan
 * async function downloadTikTok() {
 *   try {
 *     const response = await fetch('/api/downloader/tiktok', {
 *       method: 'POST',
 *       headers: { 'Content-Type': 'application/json' },
 *       // PENTING: Gunakan format JSON valid (key dengan kutip ganda) agar Auto Fill berfungsi
 *       body: JSON.stringify({ "url": "https://www.tiktok.com/@brilionet/video/7483341650115267847" })
 *     });
 * 
 *     const data = await response.json();
 *     console.log(data);
 *   } catch (error) {
 *     console.error('Error:', error.message);
 *   }
 * }
 * 
 * downloadTikTok();
 */
const tiktok = require('../../tiktok');

const tiktokController = async (req) => {
    const { url } = req.body;

    if (!url) {
        throw new Error("Parameter 'url' wajib diisi dalam body JSON.");
    }

    const result = await tiktok.download(url);

    return {
        success: true,
        code: 200,
        message: "Berhasil mendapatkan data video TikTok.",
        author: 'Tiyanz',
        result: result
    };
};

module.exports = tiktokController;
/**
 * @title Facebook DL
 * @summary Download video Facebook.
 * @description Mengunduh video dari Facebook menggunakan layanan fsave.io. Mengembalikan thumbnail dan link download video dalam kualitas SD dan HD.
 * @method POST
 * @path /api/downloader/fbdl
 * @response json
 * @param {string} body.url - URL lengkap dari video Facebook yang ingin diunduh.
 * @example
 * async function downloadFB() {
 *   try {
 *     const response = await fetch('/api/downloader/fbdl', {
 *       method: 'POST',
 *       headers: { 'Content-Type': 'application/json' },
 *       body: JSON.stringify({ 
 *         "url": "https://www.facebook.com/reel/861262849136029/" 
 *       })
 *     });
 * 
 *     const data = await response.json();
 *     console.log(data);
 *   } catch (error) {
 *     console.error('Error:', error.message);
 *   }
 * }
 * 
 * downloadFB();
 */
const { fbdl } = require('../../fbdl');

const fbdlController = async (req) => {
    const { url } = req.body;

    if (!url) {
        throw new Error("Parameter 'url' wajib diisi.");
    }

    const result = await fbdl(url);

    if (result.error) {
        throw new Error(result.message);
    }

    return {
        success: true,
        author: 'Tiyanz',
        result: result
    };
};

module.exports = fbdlController;
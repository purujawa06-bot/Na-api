/**
 * @title Facebook Downloader
 * @summary Download video Facebook (Reel/Watch/Video).
 * @description Mendownload video Facebook menggunakan Embed Plugin Facebook. Mendukung format Reel, Watch, dan Video biasa. Menghasilkan link HD, SD, thumbnail, subtitles, dan daftar kualitas video.
 * @method POST
 * @path /api/downloader/fb
 * @response json
 * @param {string} body.url - URL lengkap video Facebook (reel, watch, atau videos).
 * @example
 * async function downloadFB() {
 *   try {
 *     const response = await fetch('/api/downloader/fb', {
 *       method: 'POST',
 *       headers: { 'Content-Type': 'application/json' },
 *       body: JSON.stringify({ 
 *         "url": "https://www.facebook.com/reel/2195585950845288" 
 *       })
 *     });
 *     const data = await response.json();
 *     console.log(data);
 *   } catch (error) {
 *     console.error('Error:', error.message);
 *   }
 * }
 * 
 * downloadFB();
 */
const { fbdown } = require('../../fbdown');

const fbController = async (req) => {
    const { url } = req.body;

    if (!url) {
        throw new Error("Parameter 'url' wajib diisi.");
    }

    const result = await fbdown(url, {
        includeThumbnail: true,
        includeSubtitles: true
    });

    return {
        success: true,
        author: 'PuruBoy',
        result
    };
};

module.exports = fbController;

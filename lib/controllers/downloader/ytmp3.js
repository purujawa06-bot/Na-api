/**
 * @title YTMP3 Audio
 * @summary YouTube to MP3.
 * @description Mengonversi dan mengunduh audio YouTube dalam format MP3 menggunakan layanan YTMP3.mobi.
 * @method POST
 * @path /api/downloader/ytmp3
 * @response json
 * @param {string} body.url - URL Video YouTube yang ingin diunduh.
 * @example
 * async function downloadMp3() {
 *   const res = await fetch('/api/downloader/ytmp3', {
 *     method: 'POST',
 *     headers: { 'Content-Type': 'application/json' },
 *     body: JSON.stringify({ "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ" })
 *   });
 *   const data = await res.json();
 *   console.log(data);
 * }
 */
const savetube = require('../../savetube');

const ytmp3Controller = async (req) => {
    const { url, quality } = req.body;

    if (!url) {
        throw new Error("Parameter 'url' wajib diisi.");
    }

    // Get info
    const info = await savetube.getInfo(url);

    // Default MP3 quality = 128kbps
    const targetQuality = quality || '128';
    const downloadData = await savetube.getDownload(info.cdn, info.key, targetQuality, 'audio');

    return {
        success: true,
        author: 'Tiyanz',
        result: {
            title: info.title,
            thumbnail: info.thumbnail,
            quality: targetQuality,
            type: 'audio',
            downloadUrl: downloadData.downloadUrl
        }
    };
};

module.exports = ytmp3Controller;
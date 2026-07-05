/**
 * @title YouTube DL
 * @summary YouTube Downloader (YTDown).
 * @description Mengunduh video dan audio dari YouTube menggunakan layanan YTDown. Mendukung berbagai resolusi (hingga 1080p FHD).
 * @method POST
 * @path /api/downloader/youtube
 * @response json
 * @param {string} body.url - URL video YouTube yang valid.
 * @example
 * async function dl() {
 *   const res = await fetch('/api/downloader/youtube', {
 *     method: 'POST',
 *     headers: { 'Content-Type': 'application/json' },
 *     body: JSON.stringify({ "url": "https://www.youtube.com/watch?v=Fmf-G9fpwto" })
 *   });
 *   const data = await res.json();
 *   console.log(data);
 * }
 */
const savetube = require('../../savetube');

const youtubeController = async (req) => {
    const { url, quality } = req.body;

    if (!url) {
        throw new Error("Parameter 'url' wajib diisi.");
    }

    // Get info
    const info = await savetube.getInfo(url);

    // Find best video quality or use requested quality
    const targetQuality = quality || '720';
    const downloadData = await savetube.getDownload(info.cdn, info.key, targetQuality, 'video');

    return {
        success: true,
        author: 'Tiyanz',
        result: {
            title: info.title,
            thumbnail: info.thumbnail,
            quality: targetQuality,
            type: 'video',
            downloadUrl: downloadData.downloadUrl
        }
    };
};

module.exports = youtubeController;
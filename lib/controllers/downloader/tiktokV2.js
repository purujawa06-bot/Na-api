/**
 * @title TikTok DL V2
 * @summary TikTok Downloader (TikDownloader.io).
 * @description Mengunduh video TikTok tanpa watermark atau slide foto menggunakan provider TikDownloader.io. Credit: Yabes.
 * @method POST
 * @path /api/downloader/tiktok-v2
 * @response json
 * @param {string} body.url - URL video TikTok.
 * @example
 * async function download() {
 *   const res = await fetch('/api/downloader/tiktok-v2', {
 *     method: 'POST',
 *     headers: { 'Content-Type': 'application/json' },
 *     body: JSON.stringify({ "url": "https://www.tiktok.com/@alenkainventra/video/7351044913112321288" })
 *   });
 *   const data = await res.json();
 *   console.log(data);
 * }
 */
const { tiktokDL } = require('../../tiktokV2');

const tiktokV2Controller = async (req) => {
    const { url } = req.body;

    if (!url) {
        throw new Error("Parameter 'url' wajib diisi.");
    }

    const result = await tiktokDL(url);

    if (!result.success) {
        throw new Error(result.result);
    }

    return {
        success: true,
        author: 'Tiyanz x Yabes',
        result: result.result
    };
};

module.exports = tiktokV2Controller;
/**
 * @title Snaptik TikTok DL
 * @summary Unduh Video TikTok (Snaptik).
 * @description Mengunduh video TikTok tanpa watermark menggunakan scraping Snaptik.app. Mendukung berbagai link unduhan termasuk HD.
 * @method POST
 * @path /api/downloader/snaptik
 * @response json
 * @param {string} body.url - URL video TikTok.
 * @example
 * async function download() {
 *   const res = await fetch('/api/downloader/snaptik', {
 *     method: 'POST',
 *     headers: { 'Content-Type': 'application/json' },
 *     body: JSON.stringify({ "url": "https://www.tiktok.com/@brilionet/video/7483341650115267847" })
 *   });
 *   const data = await res.json();
 *   console.log(data);
 * }
 */
const snaptik = require('../../snaptik');

const snaptikController = async (req) => {
    const { url } = req.body;

    if (!url) {
        throw new Error("Parameter 'url' wajib diisi.");
    }

    const result = await snaptik.download(url);

    return {
        success: true,
        author: 'Tiyanz',
        result: result
    };
};

module.exports = snaptikController;
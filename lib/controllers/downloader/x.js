/**
 * @title X Downloader
 * @summary X/Twitter Video Downloader.
 * @description Mengunduh video dari platform X (Twitter) menggunakan layanan xsaver.io. Mengembalikan judul video dan daftar link download kualitas yang tersedia.
 * @method POST
 * @path /api/downloader/x
 * @response json
 * @param {string} body.url - URL video X/Twitter yang ingin diunduh.
 * @example
 * async function downloadX() {
 *   const res = await fetch('/api/downloader/x', {
 *     method: 'POST',
 *     headers: { 'Content-Type': 'application/json' },
 *     body: JSON.stringify({ "url": "https://x.com/elsyandria/status/1218385778880831488" })
 *   });
 *   const data = await res.json();
 *   console.log(data);
 * }
 */
const { getXVideoInfo } = require('../../xdownloader');

const xDownloaderController = async (req) => {
    const { url } = req.body;

    if (!url) {
        throw new Error("Parameter 'url' wajib diisi.");
    }

    const result = await getXVideoInfo(url);

    if (!result.success) {
        throw new Error(result.message);
    }

    return {
        success: true,
        author: 'Tiyanz',
        result: result
    };
};

module.exports = xDownloaderController;
/**
 * @title SoundCloud DL V2
 * @summary SoundCloud Downloader V2 (Direct).
 * @description Mengunduh lagu dari SoundCloud menggunakan metode direct scraping (Client ID Extraction). Lebih stabil dan cepat.
 * @method POST
 * @path /api/downloader/soundcloud-v2
 * @response json
 * @param {string} body.url - URL lagu SoundCloud yang valid.
 * @example
 * async function downloadSC() {
 *   const res = await fetch('/api/downloader/soundcloud-v2', {
 *     method: 'POST',
 *     headers: { 'Content-Type': 'application/json' },
 *     body: JSON.stringify({ 
 *       "url": "https://soundcloud.com/tyo-rizki-413604039/dj-ya-odna-x-the-drum-breakbeat-andra-fvnky-rmx" 
 *     })
 *   });
 *   const data = await res.json();
 *   console.log(data);
 * }
 */
const { scdl } = require('../../scdl');

const soundcloudV2Controller = async (req) => {
    const { url } = req.body;

    if (!url) {
        throw new Error("Parameter 'url' wajib diisi.");
    }

    const result = await scdl(url);

    return {
        success: true,
        author: 'Tiyanz',
        result: result
    };
};

module.exports = soundcloudV2Controller;
/**
 * @title Instagram Downloader
 * @summary Download Instagram Media (Reels/Photo/Carousel) + Metadata.
 * @description Mengunduh konten Instagram (Video Reels, Foto, Carousel) lengkap dengan metadata seperti caption, author, thumbnail, dan link download.
 * @method POST
 * @path /api/downloader/instagram
 * @response json
 * @param {string} body.url - URL media Instagram.
 * @example
 * async function downloadIg() {
 *   const res = await fetch('/api/downloader/instagram', {
 *     method: 'POST',
 *     headers: { 'Content-Type': 'application/json' },
 *     body: JSON.stringify({ "url": "https://www.instagram.com/reel/DV5hrHUEg4U/" })
 *   });
 *   const data = await res.json();
 *   console.log(data);
 * }
 */
const { scrapeInstagram } = require('../../instagram');

const instagramController = async (req) => {
    const { url } = req.body;

    if (!url) {
        throw new Error("Parameter 'url' wajib diisi.");
    }

    const result = await scrapeInstagram(url);

    return result;
};

module.exports = instagramController;

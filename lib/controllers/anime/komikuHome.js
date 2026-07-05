/**
 * @title Komiku Home
 * @summary Update Terbaru Komiku.
 * @description Mengambil daftar update manga/manhwa/manhua terbaru dari Komiku.
 * @method GET
 * @path /api/anime/komiku/home
 * @response json
 * @example
 * async function getUpdates() {
 *   const res = await fetch('/api/anime/komiku/home');
 *   const data = await res.json();
 *   console.log(data);
 * }
 */
const { scrapeHome } = require('../../komiku');

const komikuHomeController = async (req) => {
    const origin = req.origin || '';
    const result = await scrapeHome(origin);

    return {
        success: true,
        author: 'Tiyanz',
        result: result
    };
};

module.exports = komikuHomeController;
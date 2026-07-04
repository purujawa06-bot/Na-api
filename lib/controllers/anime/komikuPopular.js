/**
 * @title Komiku Populer
 * @summary Daftar Komik Populer.
 * @description Mengambil daftar komik paling populer/hot dari Komiku. Mendukung paginasi melalui parameter page.
 * @method GET
 * @path /api/anime/komiku/popular
 * @response json
 * @param {number} [query.page] - Nomor halaman (default: 1).
 * @example
 * async function getPopular() {
 *   const res = await fetch('/api/anime/komiku/popular?page=1');
 *   const data = await res.json();
 *   console.log(data);
 * }
 */
const { scrapePopular } = require('../../komiku');

const komikuPopularController = async (req) => {
    const { page } = req.query;
    const origin = req.origin || '';

    const pageNum = page ? parseInt(page) : 1;
    const result = await scrapePopular(pageNum, origin);

    return {
        success: true,
        author: 'Tiyanz',
        result: result
    };
};

module.exports = komikuPopularController;
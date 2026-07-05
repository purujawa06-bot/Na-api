/**
 * @title MAL Popular
 * @summary MyAnimeList Popular Anime.
 * @description Mengambil daftar anime populer (Top Anime) dari MyAnimeList via Jikan API.
 * @method GET
 * @path /api/anime/mal/popular
 * @response json
 * @param {number} [query.page] - Nomor halaman (default: 1).
 * @param {number} [query.limit] - Jumlah item per halaman (default: 10).
 * @example
 * async function getPopular() {
 *   const res = await fetch('/api/anime/mal/popular?page=1');
 *   const data = await res.json();
 *   console.log(data);
 * }
 */
const jikan = require('../../jikan');

const malPopularController = async (req) => {
    const { page, limit } = req.query;
    
    const pageNum = page ? parseInt(page) : 1;
    const limitNum = limit ? parseInt(limit) : 10;

    const result = await jikan.getTopAnime(pageNum, limitNum);

    return {
        success: true,
        author: 'Tiyanz',
        result: result
    };
};

module.exports = malPopularController;
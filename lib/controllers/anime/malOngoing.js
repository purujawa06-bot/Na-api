/**
 * @title MAL Ongoing
 * @summary MyAnimeList Ongoing Anime.
 * @description Mengambil daftar anime yang sedang tayang (Season Now) dari MyAnimeList via Jikan API.
 * @method GET
 * @path /api/anime/mal/ongoing
 * @response json
 * @param {number} [query.page] - Nomor halaman (default: 1).
 * @param {number} [query.limit] - Jumlah item per halaman (default: 10).
 * @example
 * async function getOngoing() {
 *   const res = await fetch('/api/anime/mal/ongoing?page=1');
 *   const data = await res.json();
 *   console.log(data);
 * }
 */
const jikan = require('../../jikan');

const malOngoingController = async (req) => {
    const { page, limit } = req.query;
    
    const pageNum = page ? parseInt(page) : 1;
    const limitNum = limit ? parseInt(limit) : 10;

    const result = await jikan.getSeasonNow(pageNum, limitNum);

    return {
        success: true,
        author: 'Tiyanz',
        result: result
    };
};

module.exports = malOngoingController;
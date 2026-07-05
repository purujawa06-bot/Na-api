/**
 * @title MAL Search
 * @summary MyAnimeList Search.
 * @description Mencari anime di MyAnimeList berdasarkan kata kunci.
 * @method GET
 * @path /api/anime/mal/search
 * @response json
 * @param {string} query.q - Kata kunci pencarian.
 * @param {number} [query.page] - Nomor halaman (default: 1).
 * @param {number} [query.limit] - Jumlah item per halaman (default: 10).
 * @example
 * async function searchMAL() {
 *   const res = await fetch('/api/anime/mal/search?q=Naruto');
 *   const data = await res.json();
 *   console.log(data);
 * }
 */
const jikan = require('../../jikan');

const malSearchController = async (req) => {
    const { q, page, limit } = req.query;

    if (!q) {
        throw new Error("Parameter 'q' wajib diisi.");
    }
    
    const pageNum = page ? parseInt(page) : 1;
    const limitNum = limit ? parseInt(limit) : 10;

    const result = await jikan.searchAnime(q, pageNum, limitNum);

    return {
        success: true,
        author: 'Tiyanz',
        result: result
    };
};

module.exports = malSearchController;
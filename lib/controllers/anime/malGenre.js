/**
 * @title MAL Genre
 * @summary MyAnimeList Genre Search.
 * @description Mencari anime berdasarkan ID Genre di MyAnimeList. ID Genre bisa didapatkan dari dokumentasi Jikan atau MAL (misal: 1 = Action).
 * @method GET
 * @path /api/anime/mal/genre
 * @response json
 * @param {number} query.genreId - ID Genre (contoh: 1 untuk Action, 2 untuk Adventure).
 * @param {number} [query.page] - Nomor halaman (default: 1).
 * @param {number} [query.limit] - Jumlah item per halaman (default: 10).
 * @example
 * async function getByGenre() {
 *   const res = await fetch('/api/anime/mal/genre?genreId=1');
 *   const data = await res.json();
 *   console.log(data);
 * }
 */
const jikan = require('../../jikan');

const malGenreController = async (req) => {
    const { genreId, page, limit } = req.query;

    if (!genreId) {
        throw new Error("Parameter 'genreId' wajib diisi.");
    }
    
    const pageNum = page ? parseInt(page) : 1;
    const limitNum = limit ? parseInt(limit) : 10;

    const result = await jikan.getAnimeByGenre(genreId, pageNum, limitNum);

    return {
        success: true,
        author: 'Tiyanz',
        result: result
    };
};

module.exports = malGenreController;
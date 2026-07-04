/**
 * @title Anichin Genre List
 * @summary Daftar Genre Anichin.
 * @description Mengambil daftar semua genre donghua yang tersedia di Anichin beserta slug-nya.
 * @method GET
 * @path /api/anime/anichin/genres
 * @response json
 * @example
 * async function getGenres() {
 *   const res = await fetch('/api/anime/anichin/genres');
 *   const data = await res.json();
 *   console.log(data);
 * }
 */
const anichin = require('../../anichin');

const anichinGenreListController = async (req) => {
    const result = await anichin.getGenres();

    return {
        success: true,
        author: 'Tiyanz',
        result: result
    };
};

module.exports = anichinGenreListController;
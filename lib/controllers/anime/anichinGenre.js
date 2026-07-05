/**
 * @title Anichin By Genre
 * @summary Donghua By Genre.
 * @description Mengambil daftar donghua berdasarkan slug genre tertentu dari Anichin. Mendukung pagination.
 * @method GET
 * @path /api/anime/anichin/genre
 * @response json
 * @param {string} query.slug - Slug genre (contoh: "fantasy", "action").
 * @param {number} [query.page] - Nomor halaman (default: 1).
 * @example
 * async function getByGenre() {
 *   const res = await fetch('/api/anime/anichin/genre?slug=fantasy');
 *   const data = await res.json();
 *   console.log(data);
 * }
 */
const anichin = require('../../anichin');

const anichinGenreController = async (req) => {
    const { slug, page } = req.query;
    const origin = req.origin || '';

    if (!slug) {
        throw new Error("Parameter 'slug' wajib diisi.");
    }

    const pageNum = page ? parseInt(page) : 1;
    const result = await anichin.getByGenre(slug, pageNum, origin);

    return {
        success: true,
        author: 'Tiyanz',
        result: result
    };
};

module.exports = anichinGenreController;
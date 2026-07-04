/**
 * @title Lahelu Search
 * @summary Cari Meme Lahelu.
 * @description Mencari meme di Lahelu berdasarkan kata kunci.
 * @method GET
 * @path /api/search/lahelu
 * @response json
 * @param {string} query.q - Kata kunci pencarian.
 * @param {number} [query.page] - Cursor halaman (integer). Default: 0.
 * @example
 * async function searchMemes() {
 *   const res = await fetch('/api/search/lahelu?q=kucing');
 *   const data = await res.json();
 *   console.log(data);
 * }
 */
const { searchMeme } = require('../../lahelu');

const laheluSearchController = async (req) => {
    const { q, page } = req.query;

    if (!q) {
        throw new Error("Parameter 'q' wajib diisi.");
    }

    const cursor = page ? parseInt(page) : 0;
    const result = await searchMeme(q, cursor);

    return {
        success: true,
        author: 'Tiyanz',
        result: result
    };
};

module.exports = laheluSearchController;
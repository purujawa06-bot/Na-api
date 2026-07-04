/**
 * @title Pinterest Search
 * @summary Search Pinterest Pins.
 * @description Mencari gambar atau pin di Pinterest berdasarkan kata kunci. Mengambil sesi dan token secara otomatis untuk mengakses API internal Pinterest.
 * @method GET
 * @path /api/search/pinterest
 * @response json
 * @param {string} query.q - Kata kunci pencarian (contoh: "Anime Wallpaper").
 * @example
 * async function pinterestSearch() {
 *   try {
 *     const res = await fetch('/api/search/pinterest?q=Anime Wallpaper');
 *     const data = await res.json();
 *     console.log(data);
 *   } catch (e) {
 *     console.error(e);
 *   }
 * }
 */
const { search } = require('../../pinterest');

const pinterestSearchController = async (req) => {
    const { q } = req.query;

    if (!q) {
        throw new Error("Parameter 'q' wajib diisi.");
    }

    const result = await search(q);

    return {
        success: true,
        author: 'Tiyanz',
        result: result
    };
};

module.exports = pinterestSearchController;
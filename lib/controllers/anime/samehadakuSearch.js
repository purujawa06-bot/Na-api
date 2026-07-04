/**
 * @title Samehadaku Search
 * @summary Pencarian Anime Samehadaku.
 * @description Mencari judul anime di Samehadaku. Mengembalikan daftar anime relevan lengkap dengan skor, status, dan genre yang diekstrak dari meta tooltip.
 * @method GET
 * @path /api/anime/samehadaku/search
 * @response json
 * @param {string} query.q - Kata kunci pencarian (contoh: "Boruto").
 * @example
 * async function search() {
 *   const res = await fetch('/api/anime/samehadaku/search?q=Boruto');
 *   const data = await res.json();
 *   console.log(data);
 * }
 */
const { search } = require('../../samehadaku');

const samehadakuSearchController = async (req) => {
    const { q } = req.query;
    const origin = req.origin || '';

    if (!q) {
        throw new Error("Parameter 'q' wajib diisi.");
    }

    const result = await search(q, origin);

    return {
        success: true,
        author: 'Tiyanz',
        result: result
    };
};

module.exports = samehadakuSearchController;
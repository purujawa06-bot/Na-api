/**
 * @title Anichin Search
 * @summary Pencarian Anichin.
 * @description Mencari seri donghua di Anichin berdasarkan kata kunci.
 * @method GET
 * @path /api/anime/anichin/search
 * @response json
 * @param {string} query.q - Kata kunci pencarian (contoh: "Btth").
 * @param {number} [query.page] - Nomor halaman (default: 1).
 * @example
 * async function search() {
 *   const res = await fetch('/api/anime/anichin/search?q=Btth');
 *   const data = await res.json();
 *   console.log(data);
 * }
 */
const anichin = require('../../anichin');

const anichinSearchController = async (req) => {
    const { q, page } = req.query;
    const origin = req.origin || '';

    if (!q) {
        throw new Error("Parameter 'q' wajib diisi.");
    }

    const pageNum = page ? parseInt(page) : 1;
    const result = await anichin.search(q, pageNum, origin);

    return {
        success: true,
        author: 'Tiyanz',
        result: result
    };
};

module.exports = anichinSearchController;
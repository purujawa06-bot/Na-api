/**
 * @title Yahoo Search
 * @summary Search information on Yahoo.
 * @description Mencari informasi web secara langsung dari mesin pencari Yahoo. Mengembalikan judul, link, dan cuplikan konten.
 * @method GET
 * @path /api/search/yahoo
 * @response json
 * @param {string} query.q - Kata kunci pencarian.
 * @example
 * async function searchYahoo() {
 *   const res = await fetch('/api/search/yahoo?q=berita+terkini');
 *   const data = await res.json();
 *   console.log(data);
 * }
 */
const { search } = require('../../yahooSearch');

const yahooController = async (req) => {
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

module.exports = yahooController;
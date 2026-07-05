/**
 * @title Komiku Search
 * @summary Pencarian Komik.
 * @description Mencari komik di Komiku berdasarkan kata kunci.
 * @method GET
 * @path /api/anime/komiku/search
 * @response json
 * @param {string} query.q - Kata kunci pencarian (contoh: "Solo Leveling").
 * @example
 * async function searchKomik() {
 *   const res = await fetch('/api/anime/komiku/search?q=Solo Leveling');
 *   const data = await res.json();
 *   console.log(data);
 * }
 */
const { scrapeSearch } = require('../../komiku');

const komikuSearchController = async (req) => {
    const { q } = req.query;
    const origin = req.origin || '';

    if (!q) {
        throw new Error("Parameter 'q' wajib diisi.");
    }

    const result = await scrapeSearch(q, origin);

    return {
        success: true,
        author: 'Tiyanz',
        result: result
    };
};

module.exports = komikuSearchController;
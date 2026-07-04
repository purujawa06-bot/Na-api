/**
 * @title Oploverz Search
 * @summary Oploverz Search.
 * @description Mencari anime di Oploverz berdasarkan kata kunci menggunakan API backend resmi mereka.
 * @method GET
 * @path /api/anime/oploverz/search
 * @response json
 * @param {string} query.q - Kata kunci pencarian (contoh: "Naruto").
 * @example
 * async function search() {
 *   const res = await fetch('/api/anime/oploverz/search?q=Naruto');
 *   const data = await res.json();
 *   console.log(data);
 * }
 */
const { searchAnime } = require('../../oploverz');

const oploverzSearchController = async (req) => {
    const { q } = req.query;
    const origin = req.origin || '';

    if (!q) {
        throw new Error("Parameter 'q' wajib diisi.");
    }

    const result = await searchAnime(q, origin);

    return {
        success: true,
        author: 'Tiyanz',
        result: result
    };
};

module.exports = oploverzSearchController;
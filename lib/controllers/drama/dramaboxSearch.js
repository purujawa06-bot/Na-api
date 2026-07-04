/**
 * @title Dramabox Search
 * @summary Search drama Dramabox.
 * @description Mencari drama di Dramabox berdasarkan kata kunci.
 * @method GET
 * @path /api/drama/dramabox/search
 * @response json
 * @param {string} query.q - Kata kunci pencarian.
 * @param {number} query.page - Halaman (default: 1).
 * @example
 * async function searchDrama() {
 *   const res = await fetch('/api/drama/dramabox/search?q=love');
 *   const data = await res.json();
 *   console.log(data);
 * }
 */
const { searchDramas } = require('../../dramabox');

const dramaboxSearchController = async (req) => {
    const { q, page } = req.query;

    if (!q) {
        throw new Error("Parameter 'q' wajib diisi.");
    }

    const result = await searchDramas(q, parseInt(page) || 1);

    return {
        success: true,
        author: 'PuruBoy',
        result: result
    };
};

module.exports = dramaboxSearchController;

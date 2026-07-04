/**
 * @title Anichin Detail
 * @summary Detail Donghua Anichin.
 * @description Mengambil informasi lengkap seri donghua dari Anichin, termasuk sinopsis, genre, link batch, dan daftar episode.
 * @method GET
 * @path /api/anime/anichin/detail
 * @response json
 * @param {string} query.url - Path atau URL donghua (contoh: /seri/battle-through-the-heavens-season-5/).
 * @example
 * async function getDetail() {
 *   const res = await fetch('/api/anime/anichin/detail?url=/seri/battle-through-the-heavens-season-5/');
 *   const data = await res.json();
 *   console.log(data);
 * }
 */
const anichin = require('../../anichin');

const anichinDetailController = async (req) => {
    const { url } = req.query;
    const origin = req.origin || '';

    if (!url) {
        throw new Error("Parameter 'url' wajib diisi.");
    }

    const result = await anichin.getDetail(url, origin);

    return {
        success: true,
        author: 'Tiyanz',
        result: result
    };
};

module.exports = anichinDetailController;
/**
 * @title Samehadaku Detail
 * @summary Detail Anime Samehadaku.
 * @description Mengambil informasi detail anime Samehadaku berdasarkan URL atau Path. Mengembalikan metadata, sinopsis, daftar genre, rekomendasi, dan list episode.
 * @method GET
 * @path /api/anime/samehadaku/detail
 * @response json
 * @param {string} query.url - URL Samehadaku (original link) atau Path relatif.
 * @example
 * async function getDetail() {
 *   const res = await fetch('/api/anime/samehadaku/detail?url=/anime/golden-kamuy-final-season/');
 *   const data = await res.json();
 *   console.log(data);
 * }
 */
const { getDetail } = require('../../samehadaku');

const samehadakuDetailController = async (req) => {
    const { url } = req.query;
    const origin = req.origin || '';

    if (!url) {
        throw new Error("Parameter 'url' wajib diisi.");
    }

    const result = await getDetail(url, origin);

    return {
        success: true,
        author: 'Tiyanz',
        result: result
    };
};

module.exports = samehadakuDetailController;
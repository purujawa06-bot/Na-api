/**
 * @title Komiku Detail
 * @summary Detail Komik.
 * @description Mengambil informasi detail dan daftar chapter dari komik tertentu.
 * @method GET
 * @path /api/anime/komiku/detail
 * @response json
 * @param {string} query.url - URL Komik (contoh: https://komiku.org/manga/solo-leveling-id/).
 * @example
 * async function getDetail() {
 *   const res = await fetch('/api/anime/komiku/detail?url=https://komiku.org/manga/solo-leveling-id/');
 *   const data = await res.json();
 *   console.log(data);
 * }
 */
const { scrapeDetail } = require('../../komiku');

const komikuDetailController = async (req) => {
    const { url } = req.query;
    const origin = req.origin || '';

    if (!url) {
        throw new Error("Parameter 'url' wajib diisi.");
    }

    const result = await scrapeDetail(url, origin);

    return {
        success: true,
        author: 'Tiyanz',
        result: result
    };
};

module.exports = komikuDetailController;
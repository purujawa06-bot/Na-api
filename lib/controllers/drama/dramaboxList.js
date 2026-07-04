/**
 * @title Dramabox Episode List
 * @summary Daftar episode/chapter drama Dramabox.
 * @description Mengambil daftar episode/chapter dari drama Dramabox berdasarkan slug.
 * @method GET
 * @path /api/drama/dramabox/list
 * @response json
 * @param {string} query.slug - Slug drama (contoh: Think-Again-Im-the-Hidden-Boss-Mom).
 * @example
 * async function getEpisodes() {
 *   const res = await fetch('/api/drama/dramabox/list?slug=Think-Again-Im-the-Hidden-Boss-Mom');
 *   const data = await res.json();
 *   console.log(data);
 * }
 */
const { getChapters } = require('../../dramabox');

const dramaboxListController = async (req) => {
    const { slug } = req.query;

    if (!slug) {
        throw new Error("Parameter 'slug' wajib diisi.");
    }

    const result = await getChapters(slug);

    return {
        success: true,
        author: 'PuruBoy',
        result: {
            slug,
            totalEpisodes: result.length,
            episodes: result
        }
    };
};

module.exports = dramaboxListController;

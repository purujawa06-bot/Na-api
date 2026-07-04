/**
 * @title Dramabox Detail
 * @summary Detail drama Dramabox.
 * @description Mengambil informasi lengkap drama dari Dramabox berdasarkan slug, termasuk sinopsis, jumlah episode, dan daftar chapter.
 * @method GET
 * @path /api/drama/dramabox/detail
 * @response json
 * @param {string} query.slug - Slug drama (contoh: Think-Again-Im-the-Hidden-Boss-Mom).
 * @example
 * async function getDetail() {
 *   const res = await fetch('/api/drama/dramabox/detail?slug=Think-Again-Im-the-Hidden-Boss-Mom');
 *   const data = await res.json();
 *   console.log(data);
 * }
 */
const { getDetail } = require('../../dramabox');

const dramaboxDetailController = async (req) => {
    const { slug } = req.query;

    if (!slug) {
        throw new Error("Parameter 'slug' wajib diisi.");
    }

    const result = await getDetail(slug);

    return {
        success: true,
        author: 'PuruBoy',
        result: result
    };
};

module.exports = dramaboxDetailController;

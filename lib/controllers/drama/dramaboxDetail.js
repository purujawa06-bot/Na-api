/**
 * @title Dramabox Detail
 * @summary Detail drama Dramabox
 * @description Mengambil informasi lengkap drama berdasarkan slug atau bookId. Data bersumber dari halaman Browse & Search (karena halaman detail tidak SSR).
 * @method GET
 * @path /api/drama/dramabox/detail
 * @response json
 * @param {string} query.slug - Slug drama (contoh: "Step-Back-I-m-the-Hidden-King")
 * @param {string} [query.bookId] - Atau bookId (contoh: "42000017882")
 * @example
 * async function getDetail() {
 *   const res = await fetch('/api/drama/dramabox/detail?slug=Step-Back-I-m-the-Hidden-King');
 *   const data = await res.json();
 *   console.log(data);
 * }
 */
const { getDetail } = require('../../dramabox');

const dramaboxDetailController = async (req) => {
    const { slug, bookId } = req.query;
    const identifier = slug || bookId;

    if (!identifier) {
        throw new Error("Parameter 'slug' atau 'bookId' wajib diisi.");
    }

    const result = await getDetail(identifier);

    return {
        success: true,
        author: 'PuruBoy',
        result
    };
};

module.exports = dramaboxDetailController;

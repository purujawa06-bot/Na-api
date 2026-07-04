/**
 * @title Dramabox Episode List
 * @summary Daftar episode/chapter drama Dramabox
 * @description Mengambil informasi jumlah episode dari suatu drama. Catatan: daftar episode detail (judul per chapter, URL video) hanya tersedia secara client-side di aplikasi Dramabox.
 * @method GET
 * @path /api/drama/dramabox/list
 * @param {string} query.slug - Slug drama
 * @param {string} query.bookId - Atau bookId
 * @response json
 */
const { getChapters } = require('../../dramabox');

const dramaboxListController = async (req) => {
    const { slug, bookId } = req.query;
    const identifier = slug || bookId;

    if (!identifier) {
        throw new Error("Parameter 'slug' atau 'bookId' wajib diisi.");
    }

    const result = await getChapters(identifier);

    return {
        success: true,
        author: 'Tiyanz',
        result
    };
};

module.exports = dramaboxListController; // trigger redeploy

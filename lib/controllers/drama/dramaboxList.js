/**
 * @title Dramabox Episode List
 * @summary Daftar episode/chapter drama Dramabox
 * @description Mengambil informasi jumlah episode dari suatu drama. Catatan: daftar episode detail (judul per chapter, URL video) hanya tersedia secara client-side di aplikasi Dramabox.
 * @method GET
 * @path /api/drama/dramabox/list
 * @response json
 * @param {string} query.slug - Slug drama (contoh: "Step-Back-I-m-the-Hidden-King")
 * @param {string} [query.bookId] - Atau bookId (contoh: "42000017882")
 * @example
 * async function getChapters() {
 *   const res = await fetch('/api/drama/dramabox/list?slug=Step-Back-I-m-the-Hidden-King');
 *   const data = await res.json();
 *   console.log(data);
 * }
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
        author: 'PuruBoy',
        result
    };
};

module.exports = dramaboxListController; // trigger redeploy

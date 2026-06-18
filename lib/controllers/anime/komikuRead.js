/**
 * @title Komiku Read
 * @summary Baca Chapter Komik.
 * @description Mengambil daftar gambar dari chapter tertentu.
 * @method GET
 * @path /api/anime/komiku/read
 * @response json
 * @param {string} query.url - URL Chapter (contoh: https://komiku.org/solo-leveling-ragnarok-chapter-68/).
 * @example
 * async function readChapter() {
 *   const res = await fetch('/api/anime/komiku/read?url=https://komiku.org/solo-leveling-ragnarok-chapter-68/');
 *   const data = await res.json();
 *   console.log(data);
 * }
 */
const { scrapeChapter } = require('../../komiku');

const komikuReadController = async (req) => {
    const { url } = req.query;
    const origin = req.origin || '';

    if (!url) {
        throw new Error("Parameter 'url' wajib diisi.");
    }

    const result = await scrapeChapter(url, origin);

    return {
        success: true,
        author: 'PuruBoy',
        result: result
    };
};

module.exports = komikuReadController;
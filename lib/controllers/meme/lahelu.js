/**
 * @title Lahelu Feed
 * @summary Get Fresh Memes.
 * @description Mengambil feed meme terbaru (Fresh) dari Lahelu. Mendukung paginasi menggunakan cursor.
 * @method GET
 * @path /api/meme/lahelu
 * @response json
 * @param {number} [query.page] - Cursor halaman (integer). Default: 0. Gunakan 'nextCursor' dari respons sebelumnya untuk halaman berikutnya.
 * @example
 * async function getMemes() {
 *   const res = await fetch('/api/meme/lahelu');
 *   const data = await res.json();
 *   console.log(data);
 * }
 */
const { getFreshFeed } = require('../../lahelu');

const laheluFeedController = async (req) => {
    const { page } = req.query;
    // cursor di Lahelu biasanya integer, default 0
    const cursor = page ? parseInt(page) : 0;

    const result = await getFreshFeed(cursor);

    return {
        success: true,
        author: 'Tiyanz',
        result: result
    };
};

module.exports = laheluFeedController;
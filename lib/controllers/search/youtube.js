/**
 * @title YouTube Search
 * @summary Search YouTube Videos.
 * @description Mencari video di YouTube berdasarkan kata kunci menggunakan provider pihak ketiga. Mengembalikan judul, link video, channel, durasi, dan thumbnail.
 * @method GET
 * @path /api/search/youtube
 * @response json
 * @param {string} query.q - Kata kunci pencarian.
 * @example
 * async function searchYouTube() {
 *   const res = await fetch('/api/search/youtube?q=DJ ya odna');
 *   const data = await res.json();
 *   console.log(data);
 * }
 */
const { search } = require('../../ytsearch');

const youtubeSearchController = async (req) => {
    const { q } = req.query;

    if (!q) {
        throw new Error("Parameter 'q' wajib diisi.");
    }

    const result = await search(q);

    return {
        success: true,
        author: 'Tiyanz',
        result: result
    };
};

module.exports = youtubeSearchController;
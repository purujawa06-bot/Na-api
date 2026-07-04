/**
 * @title Yahoo SoundCloud Search
 * @summary Cari lagu/playlist SoundCloud via Yahoo.
 * @description Mencari konten SoundCloud (track atau playlist) menggunakan mesin pencari Yahoo. Menghasilkan output yang bersih dengan ekstraksi URL asli.
 * @method GET
 * @path /api/search/yahoo-soundcloud
 * @response json
 * @param {string} query.q - Kata kunci pencarian.
 * @param {number} [query.page] - Offset hasil pencarian (default: 1).
 * @example
 * async function search() {
 *   const res = await fetch('/api/search/yahoo-soundcloud?q=dj+ya+odna');
 *   const data = await res.json();
 *   console.log(data);
 * }
 */
const scraper = require('../../yahooSoundcloud');

const yahooSoundcloudController = async (req) => {
    const { q, page } = req.query;

    if (!q) {
        throw new Error("Parameter 'q' wajib diisi.");
    }

    const offset = page ? parseInt(page) : 1;
    const result = await scraper.search(q, offset);

    return {
        success: true,
        author: 'Tiyanz',
        result: result
    };
};

module.exports = yahooSoundcloudController;
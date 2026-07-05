/**
 * @title Lyrics Search
 * @summary Search Song Lyrics.
 * @description Mencari lirik lagu berdasarkan judul atau artis menggunakan LRCLIB. Mengembalikan lirik biasa (plain) dan tersinkronisasi (synced/LRC) jika tersedia.
 * @method GET
 * @path /api/search/lyrics
 * @response json
 * @param {string} query.q - Judul lagu atau nama artis.
 * @example
 * async function getLyrics() {
 *   const res = await fetch('/api/search/lyrics?q=Alan Walker Faded');
 *   const data = await res.json();
 *   console.log(data);
 * }
 */
const { search } = require('../../lyrics');

const lyricsSearchController = async (req) => {
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

module.exports = lyricsSearchController;
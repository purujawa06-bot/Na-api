/**
 * @title Anichin Stream
 * @summary Link Streaming Anichin.
 * @description Mengekstrak link streaming (iframe), link download per resolusi, dan navigasi (prev/next) episode dari Anichin.
 * @method GET
 * @path /api/anime/anichin/stream
 * @response json
 * @param {string} query.url - Path atau URL episode (contoh: /battle-through-the-heavens-season-5-episode-01-subtitle-indonesia/).
 * @example
 * async function getStream() {
 *   const res = await fetch('/api/anime/anichin/stream?url=/battle-through-the-heavens-season-5-episode-01-subtitle-indonesia/');
 *   const data = await res.json();
 *   console.log(data);
 * }
 */
const anichin = require('../../anichin');

const anichinStreamController = async (req) => {
    const { url } = req.query;
    const origin = req.origin || '';

    if (!url) {
        throw new Error("Parameter 'url' wajib diisi.");
    }

    const result = await anichin.getStream(url, origin);

    return {
        success: true,
        author: 'Tiyanz',
        result: result
    };
};

module.exports = anichinStreamController;
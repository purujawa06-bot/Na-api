/**
 * @title Samehadaku Stream
 * @summary Streaming & Download Samehadaku.
 * @description Mengambil data episode lengkap dari Samehadaku berdasarkan URL. Otomatis melakukan bypass AJAX untuk mendapatkan URL embed iframe server streaming, dan mengambil daftar link download file asli.
 * @method GET
 * @path /api/anime/samehadaku/stream
 * @response json
 * @param {string} query.url - URL Episode Samehadaku atau Path relatif.
 * @example
 * async function getStream() {
 *   const res = await fetch('/api/anime/samehadaku/stream?url=/golden-kamuy-final-season-episode-1/');
 *   const data = await res.json();
 *   console.log(data);
 * }
 */
const { getStream } = require('../../samehadaku');

const samehadakuStreamController = async (req) => {
    const { url } = req.query;
    const origin = req.origin || '';

    if (!url) {
        throw new Error("Parameter 'url' wajib diisi.");
    }

    const result = await getStream(url, origin);

    return {
        success: true,
        author: 'Tiyanz',
        result: result
    };
};

module.exports = samehadakuStreamController;
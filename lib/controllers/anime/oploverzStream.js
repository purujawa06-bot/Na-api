/**
 * @title Oploverz Stream
 * @summary Oploverz Stream & Download.
 * @description Mengambil link streaming dan download untuk episode anime Oploverz berdasarkan URL atau Path.
 * @method GET
 * @path /api/anime/oploverz/stream
 * @response json
 * @param {string} query.url - URL Episode Oploverz atau Path (contoh: /series/spy-x-family-s3/episode/1).
 * @example
 * async function getStream() {
 *   // Gunakan path relatif
 *   const res = await fetch('/api/anime/oploverz/stream?url=/series/spy-x-family-s3/episode/1');
 *   const data = await res.json();
 *   console.log(data);
 * }
 */
const { getDomain, getStream } = require('../../oploverz');

const oploverzStreamController = async (req) => {
    let { url } = req.query;
    const origin = req.origin || '';

    if (!url) {
        throw new Error("Parameter 'url' wajib diisi.");
    }

    const domain = await getDomain();

    // Support relative path input
    if (url && !url.startsWith('http')) {
        // Remove leading slash from url to avoid double slash if domain has it
        // domain from getDomain() includes trailing slash
        const path = url.startsWith('/') ? url.slice(1) : url;
        url = domain + path;
    }

    const result = await getStream(domain, url, origin);

    return {
        success: true,
        author: 'Tiyanz',
        result: result
    };
};

module.exports = oploverzStreamController;
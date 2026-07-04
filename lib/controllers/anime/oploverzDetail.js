/**
 * @title Oploverz Detail
 * @summary Oploverz Anime Detail.
 * @description Mengambil informasi detail anime Oploverz berdasarkan URL atau Path. Termasuk daftar episode dengan link yang disesuaikan ke API.
 * @method GET
 * @path /api/anime/oploverz/detail
 * @response json
 * @param {string} query.url - URL Oploverz (original link) atau Path (contoh: /series/spy-x-family-s3).
 * @example
 * async function getDetail() {
 *   // Gunakan path relatif (lebih stabil) atau full URL
 *   const res = await fetch('/api/anime/oploverz/detail?url=/series/spy-x-family-s3');
 *   const data = await res.json();
 *   console.log(data);
 * }
 */
const { getDomain, getDetail } = require('../../oploverz');

const oploverzDetailController = async (req) => {
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

    const result = await getDetail(domain, url, origin);

    return {
        success: true,
        author: 'Tiyanz',
        result: result
    };
};

module.exports = oploverzDetailController;
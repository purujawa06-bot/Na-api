/**
 * @title Samehadaku Embed URL
 * @summary Get Embed Iframe URL.
 * @description Mengambil link embed video (iframe) asli dari Samehadaku berdasarkan data post, nume, dan type.
 * @method GET
 * @path /api/anime/samehadaku/embed
 * @response json
 * @param {string} query.post - ID Post episode.
 * @param {string} query.nume - Nomor server (nume).
 * @param {string} query.type - Tipe embed (misal: schtml).
 * @param {string} [query.url] - URL halaman episode sebagai referer (opsional).
 * @example
 * async function getEmbed() {
 *   const res = await fetch('/api/anime/samehadaku/embed?post=47702&nume=2&type=schtml');
 *   const data = await res.json();
 *   console.log(data);
 * }
 */
const { getEmbed } = require('../../samehadaku');

const samehadakuEmbedController = async (req) => {
    const { post, nume, type, url } = req.query;

    if (!post || !nume || !type) {
        throw new Error("Parameter 'post', 'nume', dan 'type' wajib diisi.");
    }

    const result = await getEmbed(post, nume, type, url);

    return {
        success: true,
        author: 'Tiyanz',
        result: result
    };
};

module.exports = samehadakuEmbedController;
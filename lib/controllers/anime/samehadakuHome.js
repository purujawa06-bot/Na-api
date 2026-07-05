/**
 * @title Samehadaku Home
 * @summary Beranda Samehadaku.
 * @description Mengambil data dari halaman utama Samehadaku, mencakup anime Top 10 minggu ini, update episode terbaru, dan daftar project movies. Link sudah di-proxy ke API ini.
 * @method GET
 * @path /api/anime/samehadaku/home
 * @response json
 * @example
 * async function getHome() {
 *   const res = await fetch('/api/anime/samehadaku/home');
 *   const data = await res.json();
 *   console.log(data);
 * }
 */
const { getHome } = require('../../samehadaku');

const samehadakuHomeController = async (req) => {
    const origin = req.origin || '';
    const result = await getHome(origin);

    return {
        success: true,
        author: 'Tiyanz',
        result: result
    };
};

module.exports = samehadakuHomeController;
/**
 * @title Anichin Home
 * @summary Beranda Anichin.
 * @description Mengambil data dari halaman utama Anichin, mencakup featured slider, populer hari ini, rilis terbaru, dan update sidebar.
 * @method GET
 * @path /api/anime/anichin/home
 * @response json
 * @example
 * async function getHome() {
 *   const res = await fetch('/api/anime/anichin/home');
 *   const data = await res.json();
 *   console.log(data);
 * }
 */
const anichin = require('../../anichin');

const anichinHomeController = async (req) => {
    const origin = req.origin || '';
    const result = await anichin.getHome(origin);

    return {
        success: true,
        author: 'Tiyanz',
        result: result
    };
};

module.exports = anichinHomeController;
/**
 * @title Dramabox Home
 * @summary Beranda Dramabox.
 * @description Mengambil data dari halaman utama Dramabox, mencakup drama trending dan rekomendasi.
 * @method GET
 * @path /api/drama/dramabox/home
 * @response json
 * @example
 * async function getHome() {
 *   const res = await fetch('/api/drama/dramabox/home');
 *   const data = await res.json();
 *   console.log(data);
 * }
 */
const { getHome } = require('../../dramabox');

const dramaboxHomeController = async (req) => {
    const result = await getHome();

    return {
        success: true,
        author: 'PuruBoy',
        result: result
    };
};

module.exports = dramaboxHomeController;

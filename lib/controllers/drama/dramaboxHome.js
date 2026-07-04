/**
 * @title Dramabox Home
 * @summary Beranda Dramabox
 * @description Mengambil data dari halaman utama Dramabox, mencakup drama trending dan rekomendasi
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

const dramaboxHomeController = async () => {
    const result = await getHome();
    return {
        success: true,
        author: 'PuruBoy',
        result
    };
};

module.exports = dramaboxHomeController;

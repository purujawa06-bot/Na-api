/**
 * @title Dramabox Home
 * @summary Beranda Dramabox
 * @description Mengambil data dari halaman utama Dramabox, mencakup drama trending dan rekomendasi
 * @method GET
 * @path /api/drama/dramabox/home
 * @response json
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

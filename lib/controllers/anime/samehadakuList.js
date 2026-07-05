/**
 * @title Samehadaku Anime List
 * @summary Daftar Semua Anime.
 * @description Mengambil halaman daftar anime terbaru di Samehadaku. Mendukung paginasi dan mengembalikan meta pagination untuk request halaman selanjutnya.
 * @method GET
 * @path /api/anime/samehadaku/list
 * @response json
 * @param {number} [query.page] - Nomor halaman yang ingin diambil (default: 1).
 * @example
 * async function getList() {
 *   const res = await fetch('/api/anime/samehadaku/list?page=1');
 *   const data = await res.json();
 *   console.log(data);
 * }
 */
const { getList } = require('../../samehadaku');

const samehadakuListController = async (req) => {
    const { page } = req.query;
    const origin = req.origin || '';
    
    const pageNum = page ? parseInt(page) : 1;
    const result = await getList(pageNum, origin);

    return {
        success: true,
        author: 'Tiyanz',
        result: result
    };
};

module.exports = samehadakuListController;
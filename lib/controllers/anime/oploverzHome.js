/**
 * @title Oploverz Home
 * @summary Oploverz Home.
 * @description Mengambil data halaman utama Oploverz, termasuk Carousel, Trending, Rilis Terbaru, dan Tambahan Baru. Link yang dihasilkan telah disesuaikan agar mengarah kembali ke API ini.
 * @method GET
 * @path /api/anime/oploverz/home
 * @response json
 * @example
 * async function getHome() {
 *   const res = await fetch('/api/anime/oploverz/home');
 *   const data = await res.json();
 *   console.log(data);
 * }
 * 
 * getHome();
 */
const { getDomain, getHome } = require('../../oploverz');

const oploverzHomeController = async (req) => {
    // req.origin should be passed from the route handler
    const origin = req.origin || '';
    
    // Get Dynamic Domain
    const domain = await getDomain();
    
    // Scrape Home with Proxy Links
    const result = await getHome(domain, origin);
    
    return {
        success: true,
        author: 'Tiyanz',
        result: result
    };
};

module.exports = oploverzHomeController;
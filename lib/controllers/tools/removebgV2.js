/**
 * @title Remove BG V2
 * @summary Hapus Background V2 (ILoveIMG).
 * @description Menghapus latar belakang gambar menggunakan layanan ILoveIMG. Alternatif handal untuk menghapus background dengan presisi tinggi.
 * @method POST
 * @path /api/tools/removebg-v2
 * @response json
 * @param {string} body.url - URL publik dari gambar yang ingin diproses.
 * @example
 * // Contoh penggunaan
 * async function removeBg() {
 *   try {
 *     const response = await fetch('/api/tools/removebg-v2', {
 *       method: 'POST',
 *       headers: { 'Content-Type': 'application/json' },
 *       body: JSON.stringify({ 
 *         "url": "https://tiyanz-api.vercel.app/example.jpg"
 *       })
 *     });
 * 
 *     const data = await response.json();
 *     console.log(data); 
 *   } catch (error) {
 *     console.error('Error:', error.message);
 *   }
 * }
 */
const { removeBgV2 } = require('../../removebg-v2');
const { uploadToTmp } = require('../../uploader');

const removeBgV2Controller = async (req) => {
    const { url } = req.body;
    const origin = req.origin || '';

    if (!url) {
        throw new Error("Parameter 'url' wajib diisi.");
    }

    // 1. Proses hapus background via ILoveIMG (V2)
    const resultBuffer = await removeBgV2.process(url);
    
    // 2. Upload hasil ke tmpfiles (menggunakan uploader yang sama dengan V1)
    const resultUrl = await uploadToTmp(resultBuffer, `removebg-v2-${Date.now()}.png`);

    return {
        status: 'success',
        author: 'Tiyanz',
        url: origin + resultUrl
    };
};

module.exports = removeBgV2Controller;
/**
 * @title Remove BG
 * @summary Hapus Background Gambar.
 * @description Menghapus latar belakang gambar menggunakan API Pixelcut dan mengupload hasilnya ke penyimpanan sementara. Mengembalikan URL gambar hasil (PNG).
 * @method POST
 * @path /api/tools/removebg
 * @response json
 * @param {string} body.url - URL publik dari gambar yang ingin diproses.
 * @example
 * // Contoh penggunaan
 * async function removeBg() {
 *   try {
 *     const response = await fetch('/api/tools/removebg', {
 *       method: 'POST',
 *       headers: { 'Content-Type': 'application/json' },
 *       body: JSON.stringify({ 
 *         "url": "https://puruboy-api.vercel.app/example.jpg" 
 *       })
 *     });
 * 
 *     const data = await response.json();
 *     console.log(data); 
 *     // Output: { status: 'success', url: 'https://domain.com/api/media/...' }
 *   } catch (error) {
 *     console.error('Error:', error.message);
 *   }
 * }
 * 
 * removeBg();
 */
const { removeBackground } = require('../../pixelcut');
const { uploadToTmp } = require('../../uploader');

const removeBgController = async (req) => {
    const { url } = req.body;
    const origin = req.origin || '';

    if (!url) {
        throw new Error("Parameter 'url' wajib diisi.");
    }

    // 1. Unduh gambar dari URL sumber
    const imageRes = await fetch(url);
    if (!imageRes.ok) {
        throw new Error("Gagal mengunduh gambar dari URL yang diberikan.");
    }

    const arrayBuffer = await imageRes.arrayBuffer();
    const inputBuffer = Buffer.from(arrayBuffer);

    // 2. Proses hapus background via Pixelcut
    const resultBuffer = await removeBackground(inputBuffer);
    
    // 3. Upload hasil ke tmpfiles
    const resultUrl = await uploadToTmp(resultBuffer, `no-bg-${Date.now()}.png`);

    return {
        status: 'success',
        author: 'Tiyanz',
        url: origin + resultUrl
    };
};

module.exports = removeBgController;
const savetube = require('../../savetube');

/**
 * @title Savetube (YouTube DL)
 * @summary Mendownload video/audio YouTube dengan cepat menggunakan Savetube API.
 * @description Mendukung berbagai format kualitas video dan audio dari YouTube. Cukup kirim URL video, dan dapatkan link download langsung beserta metadata seperti judul, thumbnail, durasi, dan format yang tersedia.
 * @method POST
 * @path /api/downloader/savetube
 * @response json
 * @param {string} body.url - URL lengkap video YouTube yang ingin diunduh.
 * @param {string} [body.quality] - Kualitas video/audio yang diinginkan. Jika tidak diisi, akan mengembalikan semua format yang tersedia.
 * @choice 360 - 360p Video
 * @choice 480 - 480p Video
 * @choice 720 - 720p Video (HD)
 * @choice 1080 - 1080p Video (Full HD)
 * @choice 128 - 128kbps Audio
 * @param {string} [body.type] - Tipe unduhan.
 * @choice video - Format video (default)
 * @choice audio - Format audio saja
 * @example
 * // Contoh penggunaan
 * async function downloadYouTube() {
 *   try {
 *     const response = await fetch('/api/downloader/savetube', {
 *       method: 'POST',
 *       headers: { 'Content-Type': 'application/json' },
 *       body: JSON.stringify({ "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ", "quality": "720" })
 *     });
 *     const data = await response.json();
 *     console.log(data);
 *   } catch (error) {
 *     console.error('Error:', error.message);
 *   }
 * }
 * downloadYouTube();
 */

/**
 * Timeout helper - rejects if operation takes too long
 * (untuk menghindari 504 Gateway Timeout dari Vercel)
 */
function timeout(ms) {
    return new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Timeout: Video tidak dapat diproses - mungkin memiliki batasan umur (age-restricted) atau tidak tersedia.')), ms);
    });
}

const savetubeController = async (req) => {
    const { url, quality, type = 'video' } = req.body;

    if (!url) {
        throw new Error("Parameter 'url' wajib diisi.");
    }

    // 1. Get Info & Decrypt (with 25s timeout to avoid Vercel 504)
    const info = await Promise.race([
        savetube.getInfo(url),
        timeout(25000)
    ]);

    // 2. If quality is requested, generate specific link
    if (quality) {
        const downloadData = await savetube.getDownload(info.cdn, info.key, quality, type);
        return {
            success: true,
            author: 'PuruBoy',
            result: {
                title: info.title,
                thumbnail: info.thumbnail,
                quality: quality,
                type: type,
                downloadUrl: downloadData.downloadUrl
            }
        };
    }

    // 3. Otherwise return all metadata
    return {
        success: true,
        author: 'PuruBoy',
        result: info
    };
};

module.exports = savetubeController;

const savetube = require('../../savetube');

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

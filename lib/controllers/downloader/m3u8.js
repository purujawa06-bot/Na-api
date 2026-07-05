/**
 * @title M3U8 to MP4
 * @summary Download & convert stream M3U8 ke format MP4.
 * @description Menerima URL file M3U8, mendownload dan mengkonversinya ke MP4 menggunakan ffmpeg, kemudian menguploadnya ke hosting sementara. Mendukung file hingga ~200MB (tergantung batas tmpfiles).
 * @method POST
 * @path /api/downloader/m3u8
 * @response json
 * @param {string} body.url - URL file M3U8 yang ingin dikonversi.
 * @param {string} [body.filename] - Nama file output (optional, default: "Tiyanz-{timestamp}").
 * @example
 * async function convertM3u8() {
 *   const res = await fetch('/api/downloader/m3u8', {
 *     method: 'POST',
 *     headers: { 'Content-Type': 'application/json' },
 *     body: JSON.stringify({ "url": "https://example.com/stream.m3u8" })
 *   });
 *   const data = await res.json();
 *   console.log(data);
 * }
 */
const M3U8ToMP4Converter = require('../../m3u8');

const m3u8Controller = async (req) => {
    const { url, filename } = req.body;

    if (!url) {
        throw new Error("Parameter 'url' wajib diisi.");
    }

    const converter = new M3U8ToMP4Converter();
    
    try {
        const result = await converter.convertAndUpload(url, filename);
        
        return {
            success: true,
            author: 'Tiyanz',
            result
        };
    } catch (error) {
        converter.cleanup();
        throw error;
    }
};

module.exports = m3u8Controller;

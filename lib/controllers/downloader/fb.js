/**
 * @title Facebook Downloader
 * @summary Download video Facebook (Reel/Watch/Video/Share).
 * @description Mendownload video Facebook menggunakan Embed Plugin Facebook + fallback fsave.io. Mendukung format Reel, Watch, Video, dan Share. Menghasilkan link HD, SD, thumbnail, subtitles, dan daftar kualitas video.
 * @method POST
 * @path /api/downloader/fb
 * @response json
 * @param {string} body.url - URL lengkap video Facebook (reel, watch, videos, share).
 * @example
 * async function downloadFB() {
 *   try {
 *     const response = await fetch('/api/downloader/fb', {
 *       method: 'POST',
 *       headers: { 'Content-Type': 'application/json' },
 *       body: JSON.stringify({ 
 *         "url": "https://www.facebook.com/reel/2195585950845288" 
 *       })
 *     });
 *     const data = await response.json();
 *     console.log(data);
 *   } catch (error) {
 *     console.error('Error:', error.message);
 *   }
 * }
 * 
 * downloadFB();
 */
const { fbdown } = require('../../fbdown');
const { fbdl } = require('../../fbdl');

const fbController = async (req) => {
    const { url } = req.body;

    if (!url) {
        throw new Error("Parameter 'url' wajib diisi.");
    }

    // Step 1: Coba primary method (embed plugin)
    let result = await fbdown(url, {
        includeThumbnail: true,
        includeSubtitles: true
    });

    // Step 2: Fallback ke fsave.io jika video HD/SD tidak ada
    const hasVideo = result.video?.hd || result.video?.sd;
    const hasFormats = result.formats && result.formats.length > 0;

    if (!hasVideo && !hasFormats) {
        console.log(`[fb] Embed plugin gagal, coba fallback fsave.io untuk: ${url}`);
        
        const fbdlResult = await fbdl(url);
        
        // Merge hasil fallback ke result
        if (fbdlResult.video_hd || fbdlResult.video_sd) {
            result = {
                ...result,
                video: {
                    hd: fbdlResult.video_hd || null,
                    sd: fbdlResult.video_sd || null,
                },
                thumbnail: fbdlResult.thumbnail || result.thumbnail,
            };
        }
    }

    return {
        success: true,
        author: 'PuruBoy',
        result
    };
};

module.exports = fbController;
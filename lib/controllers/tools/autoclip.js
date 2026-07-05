/**
 * @title AI Auto Clipper
 * @summary Ubah Video Panjang Jadi Klip Viral.
 * @description Menggunakan kecerdasan buatan untuk menganalisis video panjang dan memotong bagian paling menarik secara otomatis untuk konten TikTok/Reels/Shorts. Mendukung video dengan durasi bebas selama ukuran file tidak melebihi 200MB.
 * @method POST
 * @path /api/tools/autoclip
 * @response json
 * @param {string} body.url - URL publik file video MP4 (contoh: https://github.com/purujawa06-bot/My-db/raw/refs/heads/main/video/videoplayback.mp4).
 * @example
 * async function generateClip() {
 *   const res = await fetch('/api/tools/autoclip', {
 *     method: 'POST',
 *     headers: { 'Content-Type': 'application/json' },
 *     body: JSON.stringify({ 
 *       "url": "https://github.com/purujawa06-bot/My-db/raw/refs/heads/main/video/videoplayback.mp4" 
 *     })
 *   });
 *   const data = await res.json();
 *   console.log(data);
 * }
 */
const autoclip = require('../../autoclip');

const autoclipController = async (req) => {
    const { url } = req.body;
    const origin = req.origin || '';

    if (!url) {
        throw new Error("Parameter 'url' video MP4 wajib diisi.");
    }

    const jobData = await autoclip.createJob(url);

    return {
        status: 'queued',
        author: 'Tiyanz',
        pollingUrl: `${origin}/api/tools/autoclip/status?jobId=${jobData.job_id}`
    };
};

module.exports = autoclipController;
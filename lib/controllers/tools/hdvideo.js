/**
 * @title HD Video 60FPS
 * @summary AI Video Enhancer.
 * @description Mempertajam dan membuat video menjadi sangat mulus (60 FPS) menggunakan AI. Endpoint ini akan mengembalikan job ID dan polling URL untuk memeriksa status pemrosesan.
 * @method POST
 * @path /api/tools/hdvideo
 * @response json
 * @param {string} body.url - URL publik file video (MP4) yang ingin di-HD-kan.
 * @example
 * async function makeHD() {
 *   const res = await fetch('/api/tools/hdvideo', {
 *     method: 'POST',
 *     headers: { 'Content-Type': 'application/json' },
 *     body: JSON.stringify({ "url": "https://puruboy-api.vercel.app/example.mp4" })
 *   });
 *   const data = await res.json();
 *   console.log(data);
 * }
 */
const mediaPro = require('../../mediaPro');

const hdvideoController = async (req) => {
    const { url } = req.body;
    const origin = req.origin || '';

    if (!url) {
        throw new Error("Parameter 'url' video wajib diisi.");
    }

    const jobData = await mediaPro.submitJob('hd-video', url);

    return {
        status: 'queued',
        author: 'Tiyanz',
        pollingUrl: `${origin}/api/tools/media-status?jobId=${jobData.job_id}`
    };
};

module.exports = hdvideoController;
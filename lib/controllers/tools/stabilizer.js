/**
 * @title AI Video Stabilizer
 * @summary Menstabilkan Video Shaky.
 * @description Memperbaiki guncangan (shake) pada video menggunakan teknologi AI Stabilizer. Endpoint ini akan mengembalikan job ID dan polling URL untuk memeriksa status pemrosesan.
 * @method POST
 * @path /api/tools/stabilizer
 * @response json
 * @param {string} body.url - URL publik file video (MP4) yang ingin distabilkan.
 * @example
 * async function stabilize() {
 *   const res = await fetch('/api/tools/stabilizer', {
 *     method: 'POST',
 *     headers: { 'Content-Type': 'application/json' },
 *     body: JSON.stringify({ "url": "https://puruboy-api.vercel.app/example.mp4" })
 *   });
 *   const data = await res.json();
 *   console.log(data);
 * }
 */
const stabilizer = require('../../stabilizer');

const stabilizerController = async (req) => {
    const { url } = req.body;
    const origin = req.origin || '';

    if (!url) {
        throw new Error("Parameter 'url' video wajib diisi.");
    }

    const jobData = await stabilizer.createJob(url);

    return {
        status: 'queued',
        author: 'Tiyanz',
        pollingUrl: `${origin}/api/tools/stabilizer/status?jobId=${jobData.job_id}`
    };
};

module.exports = stabilizerController;
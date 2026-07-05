/**
 * @title Voice & Audio Editor
 * @summary Ubah efek suara video/audio.
 * @description Menerapkan efek suara ke file video atau audio (MP3). Pilihan efek: bass, deep, chipmunk, echo, radio, nightcore.
 * @method POST
 * @path /api/tools/audioedit
 * @response json
 * @param {string} body.url - URL publik file media (MP4/MP3).
 * @param {string} [body.effect] - Jenis efek (bass, deep, chipmunk, echo, radio, nightcore). Default: bass.
 * @example
 * async function editAudio() {
 *   const res = await fetch('/api/tools/audioedit', {
 *     method: 'POST',
 *     headers: { 'Content-Type': 'application/json' },
 *     body: JSON.stringify({ 
 *       "url": "https://puruboy-api.vercel.app/example.mp4",
 *       "effect": "nightcore"
 *     })
 *   });
 *   const data = await res.json();
 *   console.log(data);
 * }
 */
const mediaPro = require('../../mediaPro');

const audioeditController = async (req) => {
    const { url, effect } = req.body;
    const origin = req.origin || '';

    if (!url) {
        throw new Error("Parameter 'url' media wajib diisi.");
    }

    const selectedEffect = effect || 'bass';
    const jobData = await mediaPro.submitJob('audio-edit', url, selectedEffect);

    return {
        status: 'queued',
        author: 'Tiyanz',
        pollingUrl: `${origin}/api/tools/media-status?jobId=${jobData.job_id}`
    };
};

module.exports = audioeditController;
/**
 * @title AI Video Dubbing
 * @summary Terjemahkan Suara Video (Dubbing).
 * @description Mengubah suara asli dalam video ke bahasa lain menggunakan AI dengan tetap mempertahankan nuansa suara aslinya. Mendukung bahasa Indonesia (id-ID), Inggris (en-US), dan Jepang (ja-JP).
 * @method POST
 * @path /api/tools/dubbing
 * @response json
 * @param {string} body.url - URL publik file video (MP4) yang ingin di-dubbing.
 * @param {string} [body.voice] - Kode bahasa target: 'id-ID', 'en-US', 'ja-JP'. Default: 'id-ID'.
 * @param {string} [body.prompt] - Instruksi tambahan untuk AI (misal: "Gaya bicara santai").
 * @example
 * async function startDubbing() {
 *   const res = await fetch('/api/tools/dubbing', {
 *     method: 'POST',
 *     headers: { 'Content-Type': 'application/json' },
 *     body: JSON.stringify({ 
 *       "url": "https://github.com/purujawa06-bot/My-db/raw/refs/heads/main/video/english-conversation-have-a-coffee-with-tim-shorts-ytshorts.savetube.vip.mp4",
 *       "voice": "id-ID",
 *       "prompt": "Santai Dan Gaul Bro"
 *     })
 *   });
 *   const data = await res.json();
 *   console.log(data);
 * }
 */
const dubbing = require('../../dubbing');

const dubbingController = async (req) => {
    const { url, voice, prompt } = req.body;
    const origin = req.origin || '';

    if (!url) {
        throw new Error("Parameter 'url' video wajib diisi.");
    }

    const targetVoice = voice || 'id-ID';
    const aiPrompt = prompt || '';

    const jobData = await dubbing.createJob(url, targetVoice, aiPrompt);

    return {
        status: 'queued',
        author: 'Tiyanz',
        pollingUrl: `${origin}/api/tools/dubbing/status?taskId=${jobData.task_id}`
    };
};

module.exports = dubbingController;
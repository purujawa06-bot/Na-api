/**
 * @title Media Job Status
 * @summary Cek Status Pemrosesan Media.
 * @description Memeriksa status pekerjaan untuk HD Video, atau Audio Edit. Jika selesai, akan mengembalikan URL file hasil.
 * @method GET
 * @path /api/tools/media-status
 * @response json
 * @param {string} query.jobId - ID Job yang didapat dari request sebelumnya.
 * @example
 * async function checkStatus() {
 *   const res = await fetch('/api/tools/media-status?jobId=12345abcde');
 *   const data = await res.json();
 *   console.log(data);
 * }
 */
const mediaPro = require('../../mediaPro');

const mediaStatusController = async (req) => {
    const { jobId } = req.query;

    if (!jobId) {
        throw new Error("Parameter 'jobId' wajib diisi.");
    }

    const status = await mediaPro.checkStatus(jobId);

    if (status.status === 'success' && status.url) {
        status.url = status.url.replace('http://', 'https://');
    }

    return {
        success: true,
        author: 'Tiyanz',
        result: status
    };
};

module.exports = mediaStatusController;
/**
 * @title Server Ping
 * @summary Memeriksa status server.
 * @description Endpoint ini mengembalikan status sukses beserta timestamp untuk memverifikasi bahwa server aktif dan merespons.
 * @method GET
 * @path /api/main/ping
 * @response json
 * @param {string} [query.echo] - Teks opsional yang akan dikembalikan dalam respons.
 */
const axios = require('axios');

const pingController = async (req) => {
    const { echo } = req.query;

    const responseData = {
        status: 'success',
        message: 'pong',
        timestamp: new Date().toISOString(),
        author: 'Tiyanz'
    };

    if (echo) {
        responseData.echo = echo;
    }

    // Check status of Backend Media (Encrypted Log)
    try {
        const backend1 = await axios.get('https://puruh2o-backend.hf.space/', { timeout: 10000 });
        responseData.core_media_status = backend1.status;
        responseData.core_media_online = true;
    } catch (error) {
        responseData.core_media_status = error.response?.status || 'error';
        responseData.core_media_online = false;
    }

    // Check status of Backend Worker (Encrypted Log)
    try {
        const backend2 = await axios.get('https://puruh2o-gabutcok.hf.space/', { timeout: 10000 });
        responseData.core_worker_status = backend2.status;
        responseData.core_worker_online = true;
    } catch (error) {
        responseData.core_worker_status = error.response?.status || 'error';
        responseData.core_worker_online = false;
    }

    return responseData;
};

module.exports = pingController;
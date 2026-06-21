/**
 * @title TikTok Indonesia Chart
 * @summary Mendapatkan 30 lagu trending TikTok Indonesia dari Soundcharts
 * @description Mengambil data chart TikTok Indonesia terbaru dari Soundcharts.com. Menampilkan 30 lagu terpopuler minggu ini dengan posisi, judul, dan artis.
 * @method GET
 * @path /api/chart/tiktok
 * @response json
 * @example
 * // Request
 * GET /api/chart/tiktok
 * // Response
 * {
 *   "success": true,
 *   "author": "PuruBoy",
 *   "result": [
 *     {
 *       "position": 1,
 *       "title": "DJ LIA ADE NONA MAKIN",
 *       "artist": "DJ Alexandre Da Gloria",
 *       "songId": "50d47f08-f5fe-4cce-be21-09e1934648d9"
 *     }
 *   ]
 * }
 */
const { tiktokChartIndonesia } = require('../../tiktokchart');

const tiktokChartController = async (req) => {
    const chartData = await tiktokChartIndonesia();
    const baseUrl = req.origin || '';

    const result = chartData.map(item => ({
        ...item,
        play: `${baseUrl}/api/play/soundcloud?q=${encodeURIComponent(item.title + ' ' + item.artist)}`
    }));

    return {
        success: true,
        author: 'PuruBoy',
        result
    };
};

module.exports = tiktokChartController;
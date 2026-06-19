/**
 * @title Billboard Indonesia Chart
 * @summary Mendapatkan chart musik Indonesia terbaru dari Billboard
 * @description Mengambil data 30 lagu terpopuler di Indonesia dari Billboard Indonesia Songs chart (Hot Week)
 * @method GET
 * @path /api/chart/billboard
 * @response json
 * @example
 * // Request
 * GET /api/chart/billboard
 * // Response
 * {
 *   "success": true,
 *   "author": "PuruBoy",
 *   "result": [
 *     {
 *       "rank": 1,
 *       "title": "Example Song",
 *       "artist": "Example Artist",
 *       "lastWeek": "1",
 *       "peakPos": "1",
 *       "weeksOnChart": "10",
 *       "image": "https://..."
 *     }
 *   ]
 * }
 */
const { billboardIndonesia } = require('../../billboard');

const billboardController = async (req) => {
    const chartData = await billboardIndonesia();
    const baseUrl = req.origin || '';

    const result = chartData.map(item => ({
        ...item,
        play: `${baseUrl}/api/play/soundcloud?q=${encodeURIComponent(item.title)}`
    }));

    return {
        success: true,
        author: 'PuruBoy',
        result
    };
};

module.exports = billboardController;

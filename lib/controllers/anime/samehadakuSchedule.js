/**
 * @title Samehadaku Schedule
 * @summary Jadwal Rilis Mingguan.
 * @description Mengambil jadwal rilis anime mingguan (Senin - Minggu) dengan menembak API internal Samehadaku secara langsung. Data yang dihasilkan lebih lengkap dan cepat.
 * @method GET
 * @path /api/anime/samehadaku/schedule
 * @response json
 * @example
 * async function getSchedule() {
 *   const res = await fetch('/api/anime/samehadaku/schedule');
 *   const data = await res.json();
 *   console.log(data);
 * }
 */
const { getSchedule } = require('../../samehadaku');

const samehadakuScheduleController = async (req) => {
    const origin = req.origin || '';
    const result = await getSchedule(origin);

    return {
        success: true,
        author: 'Tiyanz',
        result: result
    };
};

module.exports = samehadakuScheduleController;
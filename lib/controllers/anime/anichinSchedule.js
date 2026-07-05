/**
 * @title Anichin Schedule
 * @summary Jadwal Rilis Anichin.
 * @description Mengambil jadwal rilis donghua mingguan di Anichin.
 * @method GET
 * @path /api/anime/anichin/schedule
 * @response json
 * @example
 * async function getSchedule() {
 *   const res = await fetch('/api/anime/anichin/schedule');
 *   const data = await res.json();
 *   console.log(data);
 * }
 */
const anichin = require('../../anichin');

const anichinScheduleController = async (req) => {
    const origin = req.origin || '';
    const result = await anichin.getSchedule(origin);

    return {
        success: true,
        author: 'Tiyanz',
        result: result
    };
};

module.exports = anichinScheduleController;
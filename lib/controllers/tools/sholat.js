/**
 * @title Jadwal Sholat
 * @summary Jadwal Sholat Bulanan.
 * @description Mengambil jadwal sholat bulanan berdasarkan nama kota di Indonesia. Dilengkapi dengan algoritma similarity untuk menangani kesalahan penulisan (tyo) nama kota.
 * @method GET
 * @path /api/tools/sholat
 * @response json
 * @param {string} query.q - Nama kota (contoh: "Jakarta", "Bandung", "Subang").
 * @example
 * async function getSholat() {
 *   const res = await fetch('/api/tools/sholat?q=jakarta');
 *   const data = await res.json();
 *   console.log(data);
 * }
 */
const { getPrayerSchedule } = require('../../sholat');

const sholatController = async (req) => {
    const { q } = req.query;

    if (!q) {
        throw new Error("Parameter 'q' (nama kota) wajib diisi.");
    }

    const result = await getPrayerSchedule(q);

    return {
        success: true,
        author: 'Tiyanz',
        result: result
    };
};

module.exports = sholatController;
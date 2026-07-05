/**
 * @title MLBB Region Checker
 * @summary Cek Region & Nickname MLBB.
 * @description Mengecek region ID, nickname, dan metadata akun Mobile Legends: Bang Bang berdasarkan User ID dan Zone ID menggunakan layanan PizzoShop.
 * @method POST
 * @path /api/tools/mlbb
 * @response json
 * @param {string} body.userId - User ID Mobile Legends.
 * @param {string} body.zoneId - Zone ID Mobile Legends.
 * @example
 * async function checkML() {
 *   const res = await fetch('/api/tools/mlbb', {
 *     method: 'POST',
 *     headers: { 'Content-Type': 'application/json' },
 *     body: JSON.stringify({ 
 *       "userId": "2002113712", 
 *       "zoneId": "19417" 
 *     })
 *   });
 *   const data = await res.json();
 *   console.log(data);
 * }
 */
const { checkMLBBRegion } = require('../../mlbb');

const mlbbController = async (req) => {
    const { userId, zoneId } = req.body;

    if (!userId || !zoneId) {
        throw new Error("Parameter 'userId' dan 'zoneId' wajib diisi dalam body JSON.");
    }

    const result = await checkMLBBRegion(userId, zoneId);

    return {
        success: true,
        author: 'Tiyanz',
        result: result
    };
};

module.exports = mlbbController;
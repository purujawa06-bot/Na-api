/**
 * @title SoundCloud Search
 * @summary Search SoundCloud Tracks.
 * @description Melakukan pencarian lagu di SoundCloud berdasarkan kata kunci. Endpoint ini mengembalikan daftar lagu yang cocok beserta metadata seperti durasi dan jumlah pemutaran.
 * @method GET
 * @path /api/search/soundcloud
 * @response json
 * @param {string} query.q - Kata kunci pencarian (judul lagu/artis).
 * @param {string} [query.limit] - Batas jumlah hasil yang ditampilkan (default: 10).
 * @example
 * // Contoh penggunaan
 * async function searchSoundCloud() {
 *   try {
 *     const response = await fetch('/api/search/soundcloud?q=lofi&limit=5');
 *     const data = await response.json();
 *     console.log(data);
 *   } catch (error) {
 *     console.error('Error:', error);
 *   }
 * }
 * 
 * searchSoundCloud();
 */
const { searchSoundCloud } = require('../../soundcloudSearch');

const soundcloudSearchController = async (req) => {
    const { q, limit } = req.query;

    if (!q) {
        throw new Error("Parameter 'q' wajib diisi.");
    }

    // Parse limit to int if provided
    const limitVal = limit ? parseInt(limit) : 10;

    const result = await searchSoundCloud(q, limitVal);

    return {
        success: true,
        author: 'Tiyanz',
        result: result
    };
};

module.exports = soundcloudSearchController;
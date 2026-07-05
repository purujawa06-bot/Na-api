/**
 * @title Spotify Downloader
 * @summary Spotify to MP3.
 * @description Mengunduh lagu dari Spotify dan mengubahnya menjadi format MP3 secara otomatis menggunakan provider Spotmate. Cukup masukkan URL track Spotify.
 * @method POST
 * @path /api/downloader/spotify
 * @response json
 * @param {string} body.url - URL Track Spotify (contoh: https://open.spotify.com/track/...).
 * @example
 * async function dlSpotify() {
 *   const res = await fetch('/api/downloader/spotify', {
 *     method: 'POST',
 *     headers: { 'Content-Type': 'application/json' },
 *     body: JSON.stringify({ 
 *       "url": "https://open.spotify.com/track/0Bui3Ojn2UWcIWMDEMZSap" 
 *     })
 *   });
 *   const data = await res.json();
 *   console.log(data);
 * }
 */
const { download } = require('../../spotmate');

const spotifyController = async (req) => {
    const { url } = req.body;

    if (!url) {
        throw new Error("Parameter 'url' Spotify wajib diisi.");
    }

    if (!url.includes('spotify.com')) {
        throw new Error("URL tidak valid. Pastikan menggunakan link Spotify yang benar.");
    }

    const result = await download(url);

    return {
        success: true,
        author: 'Tiyanz',
        result: result
    };
};

module.exports = spotifyController;
/**
 * @title SoundCloud Playlist
 * @summary Get SoundCloud Playlist Tracks.
 * @description Mengambil daftar lagu lengkap dari sebuah playlist SoundCloud menggunakan scraping dinamis Client ID.
 * @method GET
 * @path /api/search/soundcloud-playlist
 * @response json
 * @param {string} query.url - URL Playlist SoundCloud.
 * @example
 * async function getPlaylist() {
 *   const res = await fetch('/api/search/soundcloud-playlist?url=https://soundcloud.com/mhd-rayyan/sets/lagu-pop-indonesia-hits-2026');
 *   const data = await res.json();
 *   console.log(data);
 * }
 */
const SoundCloudScraper = require('../../soundcloudPlaylist');
const scraper = new SoundCloudScraper();

const soundcloudPlaylistController = async (req) => {
    const { url } = req.query;

    if (!url) {
        throw new Error("Parameter 'url' playlist wajib diisi.");
    }

    const result = await scraper.getPlaylistWithFullTracks(url);

    if (!result) {
        throw new Error("Gagal mengambil data playlist.");
    }

    return {
        success: true,
        author: 'Tiyanz',
        result: result
    };
};

module.exports = soundcloudPlaylistController;
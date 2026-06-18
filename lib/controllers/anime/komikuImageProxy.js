/**
 * @title Komiku Image Proxy
 * @summary Proxy gambar komiku behind Cloudflare.
 * @description Mengambil gambar dari CDN Komiku via server-side (cloudscraper) biar client gak kena CF block.
 * @method GET
 * @path /api/anime/komiku/image-proxy
 * @response image/*
 * @param {string} query.url - URL gambar asli dari komiku.
 * @example async function getImage() {\r   const res = await fetch('/api/anime/komiku/image-proxy?url=https://img.komiku.org/upload5/solo-leveling-ragnarok/68/2026-01-08/1_a1bc02.webp');\r   const blob = await res.blob();\r   console.log('Image fetched, size:', blob.size);\r }
 */
const cloudscraper = require('cloudscraper');

const komikuImageProxyController = async (req) => {
    const { url } = req.query;

    if (!url) {
        throw new Error("Parameter 'url' wajib diisi.");
    }

    const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        'Referer': 'https://komiku.org/',
        'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
        'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
    };

    const imageBuffer = await cloudscraper.get({
        uri: url,
        headers,
        encoding: null,
        followAllRedirects: true,
    });

    return imageBuffer;
};

module.exports = komikuImageProxyController;

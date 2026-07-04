const axios = require('axios');
const FormData = require('form-data');
const { encrypt } = require('./crypto');

const MAX_TMPFILES = 10 * 1024 * 1024; // 10MB (tmpfiles limit)
const MAX_CATBOX = 200 * 1024 * 1024;  // 200MB (catbox limit)

/**
 * Upload file ke catbox.moe (max 200MB)
 */
async function uploadToCatbox(buffer, filename) {
    const form = new FormData();
    form.append('reqtype', 'fileupload');
    form.append('fileToUpload', buffer, filename);

    const resp = await axios.post('https://catbox.moe/user/api.php', form, {
        headers: {
            ...form.getHeaders(),
            'User-Agent': 'Mozilla/5.0'
        },
        timeout: 120000,
        maxContentLength: Infinity,
        maxBodyLength: Infinity
    });

    const url = (resp.data || '').trim();
    if (!url || !url.startsWith('http')) {
        throw new Error('Gagal upload ke catbox.moe: response tidak valid');
    }
    return url;
}

/**
 * Upload file ke litterbox.catbox.moe (max 1GB, temporary 24h)
 */
async function uploadToLitterbox(buffer, filename) {
    const form = new FormData();
    form.append('reqtype', 'fileupload');
    form.append('time', '24h');
    form.append('fileToUpload', buffer, filename);

    const resp = await axios.post('https://litterbox.catbox.moe/resources/internals/api.php', form, {
        headers: {
            ...form.getHeaders(),
            'User-Agent': 'Mozilla/5.0'
        },
        timeout: 120000,
        maxContentLength: Infinity,
        maxBodyLength: Infinity
    });

    const url = (resp.data || '').trim();
    if (!url || !url.startsWith('http')) {
        throw new Error('Gagal upload ke litterbox: response tidak valid');
    }
    return url;
}

/**
 * Upload file ke tmpfiles.org (max ~10MB)
 */
async function uploadToTmpfiles(buffer, filename) {
    const form = new FormData();
    form.append('file', buffer, filename);

    const resp = await axios.post('https://tmpfiles.org/api/v1/upload', form, {
        headers: {
            ...form.getHeaders(),
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        },
        timeout: 60000
    });

    if (resp.data?.status !== 'success') {
        throw new Error('Gagal mengupload ke tmpfiles.org');
    }

    const rawUrl = resp.data.data.url;
    const realUrl = rawUrl.replace(/https?:\/\/(www\.)?tmpfiles\.org\//, 'https://tmpfiles.org/dl/');
    return realUrl;
}

/**
 * Upload file ke layanan hosting sementara dengan auto-fallback.
 * Urutan: catbox.moe (200MB) -> litterbox (1GB) -> tmpfiles (10MB)
 */
async function uploadToTmp(buffer, filename = 'file.mp4') {
    if (!Buffer.isBuffer(buffer)) {
        throw new Error('Input harus berupa Buffer.');
    }

    const size = buffer.length;
    let rawUrl;

    // Coba catbox.moe dulu (max 200MB)
    if (size <= MAX_CATBOX) {
        try {
            rawUrl = await uploadToCatbox(buffer, filename);
            console.log(`[uploader] catbox.moe success: ${rawUrl}`);
        } catch (e) {
            console.log(`[uploader] catbox.moe failed: ${e.message}, coba litterbox...`);
        }
    }

    // Fallback ke litterbox (max 1GB)
    if (!rawUrl) {
        try {
            rawUrl = await uploadToLitterbox(buffer, filename);
            console.log(`[uploader] litterbox success: ${rawUrl}`);
        } catch (e) {
            console.log(`[uploader] litterbox failed: ${e.message}, coba tmpfiles...`);
        }
    }

    // Fallback terakhir ke tmpfiles (max ~10MB)
    if (!rawUrl && size <= MAX_TMPFILES) {
        try {
            rawUrl = await uploadToTmpfiles(buffer, filename);
            console.log(`[uploader] tmpfiles success: ${rawUrl}`);
        } catch (e) {
            console.log(`[uploader] tmpfiles failed: ${e.message}`);
        }
    }

    if (!rawUrl) {
        throw new Error('Semua layanan upload gagal. File mungkin terlalu besar.');
    }

    // Encrypt URL proxy
    const encrypted = encrypt(rawUrl);
    return `/api/media/${encrypted}`;
}

module.exports = { uploadToTmp };
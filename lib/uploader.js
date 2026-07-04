const axios = require('axios');
const FormData = require('form-data');
const https = require('https');
const { encrypt } = require('./crypto');

/**
 * Upload file via raw multipart HTTP request (tanpa FormData stream issues)
 */
function rawMultipartUpload(hostname, path, buffer, filename, fieldName = 'file') {
    return new Promise((resolve, reject) => {
        const boundary = '----Boundary' + Math.random().toString(36).slice(2, 16);
        const header = Buffer.from(
            `--${boundary}\r\n` +
            `Content-Disposition: form-data; name="${fieldName}"; filename="${filename}"\r\n` +
            `Content-Type: application/octet-stream\r\n\r\n`
        );
        const footer = Buffer.from(`\r\n--${boundary}--\r\n`);
        const body = Buffer.concat([header, buffer, footer]);

        const options = {
            hostname,
            path,
            method: 'POST',
            headers: {
                'Content-Type': `multipart/form-data; boundary=${boundary}`,
                'Content-Length': body.length,
                'User-Agent': 'Mozilla/5.0'
            },
            timeout: 120000
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk.toString());
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    resolve(data.trim());
                } else {
                    reject(new Error(`HTTP ${res.statusCode}: ${data.trim()}`));
                }
            });
        });

        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
        req.write(body);
        req.end();
    });
}

/**
 * Upload ke catbox.moe (max 200MB)
 */
async function uploadToCatbox(buffer, filename) {
    const text = await rawMultipartUpload(
        'catbox.moe', '/user/api.php',
        buffer, filename, 'fileToUpload'
    );
    // catbox returns the URL as plain text
    if (!text.startsWith('http')) {
        throw new Error(`Respon tidak valid: ${text}`);
    }
    return text;
}

/**
 * Upload ke litterbox.catbox.moe (max 1GB, temporary 24h)
 */
async function uploadToLitterbox(buffer, filename) {
    // Litterbox requires an additional `time` field
    const boundary = '----Boundary' + Math.random().toString(36).slice(2, 16);
    const parts = [];
    // reqtype field
    parts.push(Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="reqtype"\r\n\r\nfileupload\r\n`
    ));
    // time field
    parts.push(Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="time"\r\n\r\n24h\r\n`
    ));
    // file field
    parts.push(Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="fileToUpload"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`
    ));
    parts.push(buffer);
    parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));
    const body = Buffer.concat(parts);

    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'litterbox.catbox.moe',
            path: '/resources/internals/api.php',
            method: 'POST',
            headers: {
                'Content-Type': `multipart/form-data; boundary=${boundary}`,
                'Content-Length': body.length,
                'User-Agent': 'Mozilla/5.0'
            },
            timeout: 120000
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk.toString());
            res.on('end', () => {
                const text = data.trim();
                if (text.startsWith('http')) {
                    resolve(text);
                } else {
                    reject(new Error(`HTTP ${res.statusCode}: ${text}`));
                }
            });
        });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
        req.write(body);
        req.end();
    });
}

/**
 * Upload ke tmpfiles.org (max ~10MB) via FormData karena API-nya JSON
 */
async function uploadToTmpfiles(buffer, filename) {
    const form = new FormData();
    form.append('file', buffer, filename);

    const resp = await axios.post('https://tmpfiles.org/api/v1/upload', form, {
        headers: {
            ...form.getHeaders(),
            'User-Agent': 'Mozilla/5.0'
        },
        timeout: 60000
    });

    if (resp.data?.status !== 'success') {
        throw new Error('Gagal mengupload ke tmpfiles.org');
    }

    const rawUrl = resp.data.data.url;
    return rawUrl.replace(/https?:\/\/(www\.)?tmpfiles\.org\//, 'https://tmpfiles.org/dl/');
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
    let lastError = '';

    // Coba catbox.moe dulu (max 200MB)
    if (size <= 200 * 1024 * 1024) {
        try {
            rawUrl = await uploadToCatbox(buffer, filename);
        } catch (e) {
            lastError = `catbox: ${e.message}`;
        }
    }

    // Fallback ke litterbox (max 1GB)
    if (!rawUrl) {
        try {
            rawUrl = await uploadToLitterbox(buffer, filename);
        } catch (e) {
            lastError = `litterbox: ${e.message}`;
        }
    }

    // Fallback terakhir ke tmpfiles (max ~10MB)
    if (!rawUrl && size <= 10 * 1024 * 1024) {
        try {
            rawUrl = await uploadToTmpfiles(buffer, filename);
        } catch (e) {
            lastError = `tmpfiles: ${e.message}`;
        }
    }

    if (!rawUrl) {
        throw new Error(`Semua layanan upload gagal. ${lastError}`);
    }

    const encrypted = encrypt(rawUrl);
    return `/api/media/${encrypted}`;
}

module.exports = { uploadToTmp };
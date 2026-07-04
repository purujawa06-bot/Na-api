/**
 * M3U8 to MP4 Converter (Tanpa ffmpeg)
 * Download semua segmen TS dari playlist M3U8, gabungkan, dan upload ke tmpfiles.org
 * Terinspirasi dari cara kerja https://m3u8downloader.app/
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');
const http = require('http');
const { uploadToTmp } = require('./uploader');

/**
 * HTTP/HTTPS fetch dengan retur Promise<Buffer>
 */
function fetchBuffer(url, retries = 3) {
    return new Promise((resolve, reject) => {
        const protocol = url.startsWith('https') ? https : http;
        const attempt = (remaining) => {
            const req = protocol.get(url, {
                timeout: 30000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                }
            }, (res) => {
                if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                    // Follow redirect
                    const redirectUrl = new URL(res.headers.location, url).toString();
                    return fetchBuffer(redirectUrl, remaining).then(resolve).catch(reject);
                }
                if (res.statusCode !== 200) {
                    if (remaining > 0) {
                        setTimeout(() => attempt(remaining - 1), 1000);
                        return;
                    }
                    return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
                }
                const chunks = [];
                res.on('data', (chunk) => chunks.push(chunk));
                res.on('end', () => resolve(Buffer.concat(chunks)));
            });
            req.on('error', (err) => {
                if (remaining > 0) {
                    setTimeout(() => attempt(remaining - 1), 1000);
                    return;
                }
                reject(err);
            });
            req.on('timeout', () => {
                req.destroy();
                if (remaining > 0) {
                    setTimeout(() => attempt(remaining - 1), 1000);
                    return;
                }
                reject(new Error('Timeout'));
            });
        };
        attempt(retries);
    });
}

/**
 * Fetch teks dari URL
 */
async function fetchText(url) {
    const buf = await fetchBuffer(url);
    return buf.toString('utf8');
}

/**
 * Parse playlist M3U8, return daftar segment URLs (resolved)
 */
function parseSegments(content, baseUrl) {
    const lines = content.split('\n');
    const segments = [];
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line || line.startsWith('#')) continue;
        // Resolve relative URL
        let segmentUrl;
        if (line.startsWith('http://') || line.startsWith('https://')) {
            segmentUrl = line;
        } else {
            segmentUrl = new URL(line, baseUrl).toString();
        }
        segments.push(segmentUrl);
    }
    return segments;
}

/**
 * Parse master playlist, cari variant dengan kualitas terbaik
 */
function parseMasterPlaylist(content) {
    const lines = content.split('\n');
    let bestStream = null;
    let bestBandwidth = 0;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line.startsWith('#EXT-X-STREAM-INF:')) {
            const bandwidthMatch = line.match(/BANDWIDTH=(\d+)/);
            const bandwidth = bandwidthMatch ? parseInt(bandwidthMatch[1]) : 0;
            
            // Lihat baris berikutnya untuk URL
            if (i + 1 < lines.length) {
                const urlLine = lines[i + 1].trim();
                if (urlLine && !urlLine.startsWith('#')) {
                    if (bandwidth > bestBandwidth) {
                        bestBandwidth = bandwidth;
                        bestStream = urlLine;
                    }
                }
            }
        }
    }
    return bestStream;
}

/**
 * Download semua segmen secara paralel (maks 5 concurrent)
 */
async function downloadSegments(segments, onProgress) {
    const total = segments.length;
    const buffers = new Array(total);
    let completed = 0;

    // Process in batches of 5
    const batchSize = 5;
    for (let i = 0; i < total; i += batchSize) {
        const batch = segments.slice(i, i + batchSize);
        const results = await Promise.all(
            batch.map((url, idx) =>
                fetchBuffer(url).then(buf => {
                    buffers[i + idx] = buf;
                    completed++;
                    if (onProgress) onProgress(completed, total);
                    return buf;
                }).catch(err => {
                    throw new Error(`Gagal download segmen ${i + idx + 1}: ${err.message}`);
                })
            )
        );
    }
    return Buffer.concat(buffers);
}

class M3U8ToMP4Converter {
    constructor() {
        this.tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'm3u8-'));
    }

    getDateNow() {
        return new Date().toISOString().replace(/T/, '_').replace(/\..+/, '').replace(/:/g, '-');
    }

    formatSize(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    /**
     * Download & gabungkan segmen M3U8
     * @param {string} m3u8Url - URL playlist M3U8
     * @param {string} [filename] - Nama file output
     * @returns {Promise<{buffer: Buffer, size: number, filename: string, segmentsCount: number}>}
     */
    async convert(m3u8Url, filename) {
        // Validasi URL
        if (!m3u8Url || typeof m3u8Url !== 'string') {
            throw new Error("Parameter 'url' wajib diisi.");
        }
        if (!m3u8Url.match(/^https?:\/\//)) {
            throw new Error('URL tidak valid. Harus diawali http:// atau https://.');
        }

        const outputName = (filename || `PuruBoy-${this.getDateNow()}`) + '.mp4';

        // 1. Download playlist
        const playlistContent = await fetchText(m3u8Url);

        // 2. Cek apakah ini master playlist atau direct playlist
        let segmentBaseUrl = m3u8Url.substring(0, m3u8Url.lastIndexOf('/') + 1);
        let segments;

        if (playlistContent.includes('#EXT-X-STREAM-INF:')) {
            // Master playlist - ambil variant dengan bandwidth tertinggi
            const variantUrl = parseMasterPlaylist(playlistContent);
            if (!variantUrl) {
                throw new Error('Tidak dapat menemukan variant playlist.');
            }
            // Resolve variant URL
            const resolvedVariantUrl = variantUrl.startsWith('http')
                ? variantUrl
                : new URL(variantUrl, segmentBaseUrl).toString();
            
            // Download variant playlist
            const variantContent = await fetchText(resolvedVariantUrl);
            const variantBaseUrl = resolvedVariantUrl.substring(0, resolvedVariantUrl.lastIndexOf('/') + 1);
            segments = parseSegments(variantContent, variantBaseUrl);
        } else {
            // Direct playlist
            segments = parseSegments(playlistContent, segmentBaseUrl);
        }

        if (!segments || segments.length === 0) {
            throw new Error('Tidak ada segmen yang ditemukan di playlist.');
        }

        // 3. Download semua segmen
        const fullBuffer = await downloadSegments(segments);

        if (fullBuffer.length === 0) {
            throw new Error('Hasil download kosong.');
        }

        return {
            buffer: fullBuffer,
            size: fullBuffer.length,
            filename: outputName,
            segmentsCount: segments.length
        };
    }

    /**
     * Convert M3U8 ke MP4 dan upload ke tmpfiles
     * @param {string} m3u8Url - URL M3U8
     * @param {string} [filename] - Nama file optional
     * @returns {Promise<object>}
     */
    async convertAndUpload(m3u8Url, filename) {
        const result = await this.convert(m3u8Url, filename);

        // Upload ke tmpfiles
        const proxyUrl = await uploadToTmp(result.buffer, result.filename);

        // Cleanup
        this.cleanup();

        return {
            success: true,
            filename: result.filename,
            size: result.size,
            sizeFormatted: this.formatSize(result.size),
            segmentsCount: result.segmentsCount,
            downloadUrl: proxyUrl
        };
    }

    cleanup() {
        try {
            if (this.tempDir && fs.existsSync(this.tempDir)) {
                fs.rmSync(this.tempDir, { recursive: true, force: true });
            }
        } catch (e) {
            // ignore
        }
    }
}

module.exports = M3U8ToMP4Converter;

/**
 * M3U8 to MP4 Converter (Tanpa ffmpeg)
 * Download semua segmen TS dari playlist M3U8, gabungkan, dan upload ke tmpfiles.org
 * Terinspirasi dari cara kerja https://m3u8downloader.app/
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const axios = require('axios');
const { uploadToTmp } = require('./uploader');

const AXIOS_TIMEOUT = 60000; // 60 detik per request

/**
 * Fetch URL sebagai Buffer via axios dengan timeout & retry
 */
async function fetchBuffer(url, retries = 2) {
    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            const resp = await axios.get(url, {
                responseType: 'arraybuffer',
                timeout: AXIOS_TIMEOUT,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                },
                maxRedirects: 5,
                validateStatus: (status) => status === 200
            });
            return Buffer.from(resp.data);
        } catch (err) {
            if (attempt < retries) {
                await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
                continue;
            }
            throw new Error(`Gagal download: ${err.message}`);
        }
    }
}

/**
 * Fetch teks dari URL
 */
async function fetchText(url) {
    const resp = await axios.get(url, {
        responseType: 'text',
        timeout: AXIOS_TIMEOUT,
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        },
        maxRedirects: 5
    });
    return resp.data;
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
 * Parse master playlist, cari variant dengan bandwidth terendah (paling cepat download)
 */
function parseMasterPlaylist(content) {
    const lines = content.split('\n');
    let bestStream = null;
    let bestBandwidth = Infinity; // Cari bandwidth terendah (paling cepat)

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line.startsWith('#EXT-X-STREAM-INF:')) {
            const bandwidthMatch = line.match(/BANDWIDTH=(\d+)/);
            const bandwidth = bandwidthMatch ? parseInt(bandwidthMatch[1]) : 0;
            if (i + 1 < lines.length) {
                const urlLine = lines[i + 1].trim();
                if (urlLine && !urlLine.startsWith('#') && bandwidth > 0 && bandwidth < bestBandwidth) {
                    bestBandwidth = bandwidth;
                    bestStream = urlLine;
                }
            }
        }
    }
    return bestStream;
}

class M3U8ToMP4Converter {
    constructor() {
        this.tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'm3u8-'));
        this.tempFilePath = null;
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
     * Download M3U8 playlist & semua segmen, tulis langsung ke file
     * @param {string} m3u8Url
     * @returns {Promise<{filePath: string, size: number, filename: string, segmentsCount: number}>}
     */
    async convertToFile(m3u8Url, filename) {
        if (!m3u8Url || typeof m3u8Url !== 'string') {
            throw new Error("Parameter 'url' wajib diisi.");
        }
        if (!m3u8Url.match(/^https?:\/\//)) {
            throw new Error('URL tidak valid. Harus diawali http:// atau https://.');
        }

        const outputName = (filename || `Tiyanz-${this.getDateNow()}`) + '.mp4';
        this.tempFilePath = path.join(this.tempDir, outputName);

        // 1. Download playlist
        const playlistContent = await fetchText(m3u8Url);

        // 2. Cek master playlist atau direct
        let segmentBaseUrl = m3u8Url.substring(0, m3u8Url.lastIndexOf('/') + 1);
        let segments;

        if (playlistContent.includes('#EXT-X-STREAM-INF:')) {
            const variantUrl = parseMasterPlaylist(playlistContent);
            if (!variantUrl) {
                throw new Error('Tidak dapat menemukan variant playlist.');
            }
            const resolvedVariantUrl = variantUrl.startsWith('http')
                ? variantUrl
                : new URL(variantUrl, segmentBaseUrl).toString();

            const variantContent = await fetchText(resolvedVariantUrl);
            const variantBaseUrl = resolvedVariantUrl.substring(0, resolvedVariantUrl.lastIndexOf('/') + 1);
            segments = parseSegments(variantContent, variantBaseUrl);
        } else {
            segments = parseSegments(playlistContent, segmentBaseUrl);
        }

        if (!segments || segments.length === 0) {
            throw new Error('Tidak ada segmen yang ditemukan di playlist.');
        }

        // 3. Download & tulis langsung ke file (streaming)
        // Tulis segmen langsung ke file tanpa menyimpan semua buffer di memory
        const writeStream = fs.createWriteStream(this.tempFilePath);

        for (let i = 0; i < segments.length; i += 5) {
            const batch = segments.slice(i, i + 5);
            const buffers = await Promise.all(
                batch.map(url => fetchBuffer(url))
            );
            for (const buf of buffers) {
                writeStream.write(buf);
            }
        }

        await new Promise((resolve, reject) => {
            writeStream.end((err) => {
                if (err) reject(err);
                else resolve();
            });
        });

        const stats = fs.statSync(this.tempFilePath);
        if (stats.size === 0) {
            throw new Error('Hasil download kosong.');
        }

        return {
            filePath: this.tempFilePath,
            size: stats.size,
            filename: outputName,
            segmentsCount: segments.length
        };
    }

    /**
     * Convert M3U8 ke MP4 dan upload ke tmpfiles
     */
    async convertAndUpload(m3u8Url, filename) {
        const result = await this.convertToFile(m3u8Url, filename);

        // Baca file & upload
        const buffer = fs.readFileSync(result.filePath);
        const proxyUrl = await uploadToTmp(buffer, result.filename);

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
        } catch (e) { /* ignore */ }
    }
}

module.exports = M3U8ToMP4Converter;

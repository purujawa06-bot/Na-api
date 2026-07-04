/**
 * M3U8 to MP4 Converter menggunakan ffmpeg
 * Download stream M3U8, konversi ke MP4, upload ke tmpfiles.org
 */
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { uploadToTmp } = require('./uploader');

class M3U8ToMP4Converter {
    constructor() {
        this.tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'm3u8-'));
    }

    getDateNow() {
        return new Date().toISOString().replace(/T/, '_').replace(/\..+/, '').replace(/:/g, '-');
    }

    /**
     * Download & convert M3U8 ke MP4 via ffmpeg
     * @param {string} m3u8Url - URL file M3U8
     * @param {string} [filename] - Nama file output (optional)
     * @returns {Promise<{success: boolean, mp4Path: string, outputPath: string}>}
     */
    async convert(m3u8Url, filename) {
        return new Promise((resolve, reject) => {
            const outputName = (filename || `PuruBoy-${this.getDateNow()}`) + '.mp4';
            const outputPath = path.join(this.tempDir, outputName);

            // Validasi URL
            if (!m3u8Url || typeof m3u8Url !== 'string') {
                return reject(new Error("Parameter 'url' wajib diisi."));
            }

            if (!m3u8Url.match(/^https?:\/\//)) {
                return reject(new Error('URL tidak valid. Harus diawali http:// atau https://.'));
            }

            // Jalankan ffmpeg
            const args = [
                '-y',                       // overwrite output
                '-user_agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                '-i', m3u8Url,              // input
                '-c', 'copy',               // copy streams (no re-encode)
                '-bsf:a', 'aac_adtstoasc',  // fix AAC bitstream
                '-movflags', '+faststart',  // optimize for streaming
                '-f', 'mp4',                // force MP4 format
                outputPath
            ];

            const proc = execFile('ffmpeg', args, {
                timeout: 300000, // 5 menit timeout
                maxBuffer: 1024 * 1024 * 50 // 50MB
            }, (error, stdout, stderr) => {
                if (error) {
                    // Cleanup on error
                    this.cleanup();
                    return reject(new Error(`Konversi gagal: ${error.message}`));
                }

                // Cek file hasil
                if (!fs.existsSync(outputPath)) {
                    this.cleanup();
                    return reject(new Error('File output tidak ditemukan setelah konversi.'));
                }

                const stats = fs.statSync(outputPath);
                if (stats.size === 0) {
                    this.cleanup();
                    return reject(new Error('File output kosong. M3U8 mungkin tidak valid.'));
                }

                resolve({
                    success: true,
                    mp4Path: outputPath,
                    outputPath: outputPath,
                    size: stats.size,
                    filename: outputName
                });
            });

            // Streaming progress info ke stderr, kita log saja
            let progressLog = '';
            proc.stderr?.on('data', (data) => {
                progressLog += data.toString();
            });
        });
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
        const buffer = fs.readFileSync(result.mp4Path);
        const proxyUrl = await uploadToTmp(buffer, result.filename);
        
        // Cleanup temp file
        this.cleanup();
        
        return {
            success: true,
            filename: result.filename,
            size: result.size,
            sizeFormatted: this.formatSize(result.size),
            downloadUrl: proxyUrl
        };
    }

    formatSize(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    cleanup() {
        try {
            if (this.tempDir && fs.existsSync(this.tempDir)) {
                fs.rmSync(this.tempDir, { recursive: true, force: true });
            }
        } catch (e) {
            // ignore cleanup errors
        }
    }
}

module.exports = M3U8ToMP4Converter;

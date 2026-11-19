/**
 * @title Audio/Video Noise Remover
 * @summary Hapus noise audio/video via pdfleader.com (streaming NDJSON).
 * @description Menerima URL publik file audio/video, mengunggah ke layanan pdfleader, lalu
 *              memproses penghapusan noise. Mode `demo` (default) memproses cuplikan gratis
 *              (dibatasi `duration_seconds`, maks 30 detik) dan mengembalikan URL hasil.
 *              Mode `full` mengirim pemrosesan penuh namun pada akun anonim umumnya ditolak
 *              upstream dengan HTTP 402 (butuh pembayaran/subscription); error upstream
 *              diteruskan apa adanya.
 *
 *              Respons berupa streaming JSON (JSON Lines/NDJSON) dengan event `processing`
 *              berkala (heartbeat) dan event terminal `done`.
 * @method POST
 * @path /api/tools/noise-remover
 * @param {string} body.file - URL publik file audio/video (http/https) (wajib).
 * @param {string} [body.mode] - Mode pemrosesan: `demo` (default, cuplikan gratis) atau `full` (penuh, dapat 402/paywall).
 * @param {string} [body.filename] - Nama file opsional (petunjuk). Default diambil dari URL.
 * @param {number} [body.duration_seconds] - Durasi demo dalam detik (1-30, default 30). Diabaikan saat `mode=full`.
 * @response stream
 * @example
 * fetch('https://na-api-nue-api-e7bfd3f4.koyeb.app/api/tools/noise-remover', {
 *     method: 'POST',
 *     headers: { 'Content-Type': 'application/json' },
 *     body: JSON.stringify({ file: 'https://example.com/audio.wav', mode: 'demo', filename: 'audio.wav', duration_seconds: 30 })
 * }).then(res => res.text()).then(console.log);
 */
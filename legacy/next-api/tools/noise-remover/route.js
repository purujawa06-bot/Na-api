/**
 * @title Audio/Video Noise Remover
 * @summary Hapus noise audio/video via pdfleader.com (streaming NDJSON).
 * @description Menerima unggahan file audio/video (multipart form-data), mengunggah ke
 *              layanan pdfleader, lalu memproses penghapusan noise. Mode `demo` (default)
 *              memproses cuplikan gratis (dibatasi `duration_seconds`, maks 30 detik) dan
 *              mengembalikan URL hasil. Mode `full` mengirim pemrosesan penuh namun pada
 *              akun anonim umumnya ditolak upstream dengan HTTP 402 (butuh pembayaran/
 *              subscription); error upstream diteruskan apa adanya.
 *
 *              Respons berupa streaming JSON (JSON Lines/NDJSON) dengan event `processing`
 *              berkala dan event terminal `done`.
 * @method POST
 * @path /api/tools/noise-remover
 * @param {file} formData.file - File audio/video (maks 32 MB) (wajib).
 * @param {string} [formData.mode] - Mode pemrosesan: `demo` (default, cuplikan gratis) atau `full` (penuh, dapat 402/paywall).
 * @param {number} [formData.duration_seconds] - Durasi demo dalam detik (1-30, default 30). Diabaikan saat `mode=full`.
 * @response stream
 * @example
 * const fd = new FormData();
 * fd.append('file', fileInput.files[0]);
 * fd.append('mode', 'demo');
 * fd.append('duration_seconds', '30');
 * fetch('https://na-api-nue-api-e7bfd3f4.koyeb.app/api/tools/noise-remover', {
 *     method: 'POST',
 *     body: fd
 * }).then(res => res.text()).then(console.log);
 */
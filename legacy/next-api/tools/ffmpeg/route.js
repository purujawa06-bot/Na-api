/**
 * @title FFmpeg Media Converter
 * @summary Konversi format media (audio/video/gambar) menggunakan ffmpeg, streaming NDJSON.
 * @description Menerima unggahan file media (multipart form-data) dan mengonversinya ke
 *              format target menggunakan ffmpeg, lalu mengunggah hasil ke penyimpanan sementara.
 *              Event terminal `done` berisi `url` hasil konversi beserta `mimetype`,
 *              `filename`, dan `format`.
 *
 *              Respons berupa streaming JSON (JSON Lines/NDJSON) dengan event `processing`
 *              dan event terminal `done`.
 * @method POST
 * @path /api/tools/ffmpeg
 * @param {file} formData.file - File media input (maks 64 MB) (wajib).
 * @param {string} formData.format - Format target/output, mis. mp3, wav, ogg, opus, m4a, mp4, webm, gif (wajib).
 * @response stream
 * @example
 * const fd = new FormData();
 * fd.append('file', fileInput.files[0]);
 * fd.append('format', 'mp3');
 * fetch('https://na-api-nue-api-e7bfd3f4.koyeb.app/api/tools/ffmpeg', {
 *     method: 'POST',
 *     body: fd
 * }).then(res => res.text()).then(console.log);
 */

/**
 * @title Vocal & Instrumental Remover
 * @summary Pisahkan vokal dan musik dari audio/video via vocalremover.org (streaming NDJSON).
 * @description Menerima unggahan file audio (multipart form-data), memproses pemisahan
 *              vokal dan instrumental menggunakan vocalremover.org melalui browser CDP,
 *              lalu mengunggah hasil ke penyimpanan sementara. Event terminal `done`
 *              berisi `url`/`instrumental_url` (musik tanpa vokal/karaoke) dan, bila
 *              tersedia, `vocals_url` (trek vokal terisolasi).
 *
 *              Respons berupa streaming JSON (JSON Lines/NDJSON) dengan event `processing`
 *              berkala dan event terminal `done`. Proses bergantung pada browser remote CDP
 *              dan dapat memakan waktu lebih lama untuk file besar.
 * @method POST
 * @path /api/tools/noise-remover
 * @param {file} formData.file - File audio (maks 32 MB) (wajib).
 * @response stream
 * @example
 * const fd = new FormData();
 * fd.append('file', fileInput.files[0]);
 * fetch('https://na-api-nue-api-e7bfd3f4.koyeb.app/api/tools/noise-remover', {
 *     method: 'POST',
 *     body: fd
 * }).then(res => res.text()).then(console.log);
 */
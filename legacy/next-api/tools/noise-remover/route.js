/**
 * @title Audio Noise Remover
 * @summary Hapus noise dari audio via nirkyy-a.hf.space (DeepFilterNet, streaming NDJSON).
 * @description Menerima unggahan file audio (multipart form-data), memproses penghapusan
 *              noise menggunakan model DeepFilterNet pada Space Hugging Face
 *              `nirkyy-a.hf.space`, lalu mengunggah hasil audio bersih ke penyimpanan
 *              sementara. Event terminal `done` berisi `url` hasil audio yang sudah
 *              dibersihkan.
 *
 *              Respons berupa streaming JSON (JSON Lines/NDJSON) dengan event `processing`
 *              berkala dan event terminal `done`.
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
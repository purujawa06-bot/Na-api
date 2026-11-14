/**
 * @title JJ CapCut Generator (Create Job)
 * @summary Buat job generate video JJ (CapCut template) dari foto via cc.fgsi.dpdns.org.
 * @description Mengunggah foto ke layanan JJ Capcut (cc.fgsi.dpdns.org) dan
 *              membuat job render video dari template CapCut secara asinkron.
 *              Endpoint otomatis memilih template secara acak yang jumlah slot
 *              fotonya sesuai dengan jumlah foto yang diunggah. Jumlah foto
 *              tidak boleh melebihi slot terbanyak dari template yang tersedia.
 *              Respons mengembalikan `job_id`; gunakan endpoint GET untuk cek
 *              status/hasil. Tautan hasil (`download_url`) bertoken/bermasa berlaku.
 * @method POST
 * @path /api/downloader/jj
 * @param {file} formData.photos - File foto JPG/PNG (bisa lebih dari satu, field dapat diulang). Jumlah harus sesuai slot template dan <= slot terbanyak (wajib).
 * @param {string} [formData.template_id] - ID template tertentu (opsional). Jika diisi, jumlah foto harus sama dengan slot template tersebut; jika kosong, template dipilih acak sesuai jumlah foto.
 * @response json
 * @example
 * const fd = new FormData();
 * for (const file of fileInput.files) fd.append('photos', file);
 * // opsional: fd.append('template_id', '7649585745329540360');
 * fetch('https://na-api-nue-api-e7bfd3f4.koyeb.app/api/downloader/jj', { method: 'POST', body: fd })
 *     .then(res => res.json())
 *     .then(console.log);
 */

/**
 * @title JJ CapCut Generator (Get Job)
 * @summary Cek status/hasil job generate video JJ.
 * @description Mengambil status dan hasil job render JJ berdasarkan `id`/`job_id`
 *              yang dikembalikan saat create job. Status: `processing`,
 *              `selesai`, `gagal`, `timeout`, atau `error`. Jika selesai,
 *              `download_url` berisi tautan unduh (bertoken/bermasa berlaku).
 * @method GET
 * @path /api/downloader/jj
 * @param {string} query.id - ID job yang dikembalikan oleh endpoint create (wajib).
 * @response json
 * @example
 * fetch('https://na-api-nue-api-e7bfd3f4.koyeb.app/api/downloader/jj?id=JOB_ID')
 *     .then(res => res.json())
 *     .then(console.log);
 */

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST() {
  return new Response(JSON.stringify({ success: false, error: 'Not implemented in legacy runtime' }), { status: 501, headers: { 'Content-Type': 'application/json' } });
}

export async function GET() {
  return new Response(JSON.stringify({ success: false, error: 'Not implemented in legacy runtime' }), { status: 501, headers: { 'Content-Type': 'application/json' } });
}

/**
 * @title JJ CapCut Generator
 * @summary Generate video JJ (CapCut template) dari foto via cc.fgsi.dpdns.org.
 * @description Mengunggah foto ke layanan JJ Capcut (cc.fgsi.dpdns.org) dan
 *              menghasilkan video dari template CapCut. Endpoint otomatis
 *              memilih template secara acak yang jumlah slot fotonya sesuai
 *              dengan jumlah foto yang diunggah. Jumlah foto tidak boleh
 *              melebihi slot terbanyak dari template yang tersedia. Proses
 *              render membutuhkan waktu (beberapa menit) dan tautan hasil
 *              (download_url) bertoken/bermasa berlaku — simpan/unduh segera.
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

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST() {
  return new Response(JSON.stringify({ success: false, error: 'Not implemented in legacy runtime' }), { status: 501, headers: { 'Content-Type': 'application/json' } });
}

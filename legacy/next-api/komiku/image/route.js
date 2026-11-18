/**
 * @title Komiku Image Proxy
 * @summary Proxy gambar komik Komiku untuk ditampilkan di browser tanpa CORS.
 * @description Mengambil (fetch) gambar panel komik dari URL sumber (mis. URL
 *              gambar asli dari hasil endpoint /api/komiku/chapter) dan
 *              meneruskannya ke klien sebagai respons gambar. Berguna sebagai
 *              proxy agar gambar panel dapat dimuat di web/app tanpa terhalang
 *              CORS.
 * @method GET
 * @path /api/komiku/image
 * @param {string} query.url - URL gambar panel chapter asli (wajib, http/https).
 * @response binary
 * @example
 * fetch('https://na-api-nue-api-e7bfd3f4.koyeb.app/api/komiku/image?url=https%3A%2F%2Fimg.komiku.org%2Fupload5%2Fmy-wife-waited-for-me-in-the-wheat-%2F27%2F2026-09-01%2F1.webp')
 *     .then(res => res.blob())
 *     .then(console.log);
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET() {
  return new Response('Implemented in Go backend', { status: 501 });
}

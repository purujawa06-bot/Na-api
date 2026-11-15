/**
 * @title Brat Generator
 * @summary Generate gambar teks gaya Brat (background putih, 512x512).
 * @description Merender teks menjadi gambar PNG 512x512 bergaya Brat (background putih,
 *              font Arial Narrow dengan blur halus, mendukung emoji) menggunakan renderer CDP.
 *              Respons berupa gambar langsung (image/png).
 * @method GET
 * @path /api/tools/brat
 * @param {string} query.text - Teks yang akan dirender menjadi gambar (wajib).
 * @response image
 * @example
 * fetch('https://na-api-nue-api-e7bfd3f4.koyeb.app/api/tools/brat?text=hello%20brat')
 *     .then(res => res.blob())
 *     .then(console.log);
 */

/**
 * @title Brat Generator
 * @summary Generate gambar teks gaya Brat (background putih, 512x512).
 * @description Merender teks menjadi gambar PNG 512x512 bergaya Brat (background putih,
 *              font Arial Narrow dengan blur halus, mendukung emoji). Body JSON: {"text":"..."}.
 *              Respons berupa gambar langsung (image/png).
 * @method POST
 * @path /api/tools/brat
 * @param {string} body.text - Teks yang akan dirender menjadi gambar (wajib).
 * @response image
 * @example
 * fetch('https://na-api-nue-api-e7bfd3f4.koyeb.app/api/tools/brat', {
 *   method: 'POST',
 *   headers: { 'Content-Type': 'application/json' },
 *   body: JSON.stringify({ text: 'hello brat' })
 * }).then(res => res.blob()).then(console.log);
 */

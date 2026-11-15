/**
 * @title Brat Generator
 * @summary Generate gambar teks gaya Brat (512x512).
 * @description Merender teks menjadi gambar PNG 512x512 bergaya Brat menggunakan layanan upstream.
 *              Isi parameter `text` untuk menghasilkan gambar. Endpoint juga menerima POST
 *              (JSON `{"text":"..."}` atau form `text`).
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

/**
 * @title Web Check
 * @summary Cek status/uptime sebuah website.
 * @description Mengecek apakah sebuah website dapat diakses (up/down) berdasarkan URL yang diberikan.
 *              Endpoint mengirim permintaan HTTP ke URL target dan mengembalikan status, waktu respons,
 *              serta informasi dasar konektivitas.
 * @method GET
 * @path /api/tools/check-web
 * @param {string} query.url - URL website yang akan dicek (wajib, http/https).
 * @response json
 * @example
 * fetch('https://na-api-nue-api-e7bfd3f4.koyeb.app/api/tools/check-web?url=https://google.com')
 *     .then(res => res.json())
 *     .then(console.log);
 */
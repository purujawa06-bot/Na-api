/**
 * @title RPG Register
 * @summary Daftar atau ubah username pemain RPG.
 * @description Mendaftarkan pemain RPG berdasarkan LID WhatsApp. Jika sudah terdaftar, hanya username yang diperbarui; data RP/XP/level tetap aman. Saat register, server mengembalikan `login_code` 4 digit untuk login game. Di bot, register hanya boleh di chat pribadi (bukan grup).
 * @method POST
 * @path /api/rpg/register
 * @param {string} body.lid - LID WhatsApp pemain.
 * @param {string} body.username - Username pemain (3-24 karakter).
 * @response json
 * @example
 * fetch('https://na-api-nue-api-e7bfd3f4.koyeb.app/api/rpg/register', {
 *     method: 'POST',
 *     headers: { 'content-type': 'application/json', 'X-RPG-Secret': '<secret>' },
 *     body: JSON.stringify({ lid: '123@lid', username: 'Puru' })
 * }).then(res => res.json()).then(console.log);
 */
export async function POST() { return Response.json({ error: 'Implemented in Go backend' }, { status: 501 }); }

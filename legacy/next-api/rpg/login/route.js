/**
 * @title RPG Login
 * @summary Login pemain RPG dengan kode 4 digit.
 * @description Login sederhana menggunakan kode login yang diberikan saat register. Keamanan dilonggarkan: tanpa token sesi, tanpa expired.
 * @method POST
 * @path /api/rpg/login
 * @param {string} body.code - Kode login 4 digit dari .register.
 * @response json
 * @example
 * fetch('https://na-api-nue-api-e7bfd3f4.koyeb.app/api/rpg/login', {
 *     method: 'POST',
 *     headers: { 'content-type': 'application/json' },
 *     body: JSON.stringify({ code: '1234' })
 * }).then(res => res.json()).then(console.log);
 */
export async function POST() { return Response.json({ error: 'Implemented in Go backend' }, { status: 501 }); }

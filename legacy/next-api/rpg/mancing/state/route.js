/**
 * @title RPG Mancing State
 * @summary Ambil state player untuk webview mancing.
 * @description Mengembalikan data player. Mendukung flow sederhana dengan `code` (login 4 digit, tanpa token/expired) dan flow lama dengan `token` sesi.
 * @method GET
 * @path /api/rpg/mancing/state
 * @param {string} query.code - Kode login 4 digit (flow sederhana).
 * @param {string} query.token - Token sesi mancing (flow lama).
 * @response json
 * @example
 * fetch('https://na-api-nue-api-e7bfd3f4.koyeb.app/api/rpg/mancing/state?code=1234').then(res => res.json()).then(console.log);
 */
export async function GET() { return Response.json({ error: 'Implemented in Go backend' }, { status: 501 }); }

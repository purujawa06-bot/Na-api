/**
 * @title RPG Mancing Heartbeat
 * @summary Update waktu aktif sesi mancing.
 * @description Menambah waktu aktif sesi mancing (server-authoritative) untuk perhitungan XP.
 * @method POST
 * @path /api/rpg/mancing/heartbeat
 * @param {string} body.token - Token sesi mancing.
 * @param {number} body.active_sec - Delta detik aktif sejak heartbeat terakhir.
 * @response json
 * @example
 * fetch('https://na-api-nue-api-e7bfd3f4.koyeb.app/api/rpg/mancing/heartbeat', {
 *     method: 'POST',
 *     headers: { 'content-type': 'application/json' },
 *     body: JSON.stringify({ token: '<session_token>', active_sec: 30 })
 * }).then(res => res.json()).then(console.log);
 */
export async function POST() { return Response.json({ error: 'Implemented in Go backend' }, { status: 501 }); }

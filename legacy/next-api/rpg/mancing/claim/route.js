/**
 * @title RPG Mancing Claim
 * @summary Klaim hasil sesi mancing.
 * @description Memfinalisasi sesi mancing: konversi ikan ke $RP (server-authoritative, capped) dan memberikan XP berdasarkan waktu aktif server.
 * @method POST
 * @path /api/rpg/mancing/claim
 * @param {string} body.token - Token sesi mancing.
 * @param {number} body.active_sec - Total detik aktif.
 * @param {array} body.catches - Daftar tangkapan [{id,count,kg}].
 * @response json
 * @example
 * fetch('https://na-api-nue-api-e7bfd3f4.koyeb.app/api/rpg/mancing/claim', {
 *     method: 'POST',
 *     headers: { 'content-type': 'application/json' },
 *     body: JSON.stringify({ token: '<session_token>', active_sec: 600, catches: [{ id: 'teri', count: 2, kg: 0.5 }] })
 * }).then(res => res.json()).then(console.log);
 */
export async function POST() { return Response.json({ error: 'Implemented in Go backend' }, { status: 501 }); }

/**
 * @title RPG Mancing Auto Save
 * @summary Auto-save progres mancing dengan kode login.
 * @description Menyimpan delta progres mancing (active_sec dan catches) langsung ke akun pemain berdasarkan kode login. Tanpa token sesi, tanpa expired. Cocok untuk auto save periodik dari webview. Tiap item catches berisi {id, count, kg}.
 * @method POST
 * @path /api/rpg/mancing/save
 * @param {string} body.code - Kode login 4 digit pemain.
 * @param {number} body.active_sec - Delta detik aktif sejak save terakhir (0-7200).
 * @param {Array<object>} body.catches - Delta tangkapan ikan sejak save terakhir; item: {id, count, kg}.
 * @response json
 * @example
 * fetch('https://na-api-nue-api-e7bfd3f4.koyeb.app/api/rpg/mancing/save', {
 *     method: 'POST',
 *     headers: { 'content-type': 'application/json' },
 *     body: JSON.stringify({ code: '1234', active_sec: 30, catches: [{ id: 'teri', count: 2, kg: 0.2 }] })
 * }).then(res => res.json()).then(console.log);
 */
export async function POST() { return Response.json({ error: 'Implemented in Go backend' }, { status: 501 }); }

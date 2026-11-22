/**
 * @title RPG Mancing Start
 * @summary Mulai sesi mancing RPG.
 * @description Membuat sesi mancing dan mengembalikan URL webview game.
 * @method POST
 * @path /api/rpg/mancing/start
 * @param {string} body.lid - LID WhatsApp pemain.
 * @response json
 * @example
 * fetch('https://na-api-nue-api-e7bfd3f4.koyeb.app/api/rpg/mancing/start', {
 *     method: 'POST',
 *     headers: { 'content-type': 'application/json', 'X-RPG-Secret': '<secret>' },
 *     body: JSON.stringify({ lid: '123@lid' })
 * }).then(res => res.json()).then(console.log);
 */
export async function POST() { return Response.json({ error: 'Implemented in Go backend' }, { status: 501 }); }

/**
 * @title RPG Stats
 * @summary Ambil statistik pemain RPG.
 * @description Mengembalikan username, $RP, level, XP, dan total ikan pemain.
 * @method GET
 * @path /api/rpg/stats
 * @param {string} query.lid - LID WhatsApp pemain.
 * @response json
 * @example
 * fetch('https://na-api-nue-api-e7bfd3f4.koyeb.app/api/rpg/stats?lid=123@lid', {
 *     headers: { 'X-RPG-Secret': '<secret>' }
 * }).then(res => res.json()).then(console.log);
 */
export async function GET() { return Response.json({ error: 'Implemented in Go backend' }, { status: 501 }); }

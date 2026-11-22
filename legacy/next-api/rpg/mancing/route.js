/**
 * @title RPG Mancing Page
 * @summary Webview game mancing RPG.
 * @description Menyajikan halaman HTML game mancing pixel untuk webview. Gunakan token sesi dari /api/rpg/mancing/start.
 * @method GET
 * @path /api/rpg/mancing
 * @param {string} query.token - Token sesi mancing.
 * @response html
 * @example
 * // Buka di webview:
 * // https://na-api-nue-api-e7bfd3f4.koyeb.app/api/rpg/mancing?token=<session_token>
 */
export async function GET() { return new Response('Implemented in Go backend', { status: 501 }); }

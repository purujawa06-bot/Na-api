/**
 * @title Find Agent Skills
 * @summary Cari skills di direktori skills.sh (setara npx skills find).
 * @description Mencari reusable agent skills (SKILL.md) di direktori terbuka
 *              skills.sh — backend yang sama dipakai perintah `npx skills find`.
 *              Tiap hasil memuat nama skill, repo sumber (owner/repo), jumlah
 *              install, perintah install siap salin, dan URL halaman skill.
 *              Install asli (`npx skills add`) berjalan di mesin client karena
 *              butuh akses folder agent lokal; gunakan endpoint install-skills
 *              untuk validasi + panduan install per-agent.
 * @method GET
 * @path /api/agent-tools/find-skills
 * @param {string} query.query - Kata kunci pencarian skill, min 2 karakter (wajib, alias: q).
 * @param {number} [query.limit] - Jumlah hasil maks (default 10, maks 20, alias: count).
 * @param {string} [query.owner] - Filter owner GitHub (mis. vercel-labs, setara --owner).
 * @response json
 * @example
 * fetch('https://puruboy-api.vercel.app/api/agent-tools/find-skills?query=web+design&limit=5')
 *     .then(res => res.json())
 *     .then(data => console.log(data));
 */
import { searchSkills } from '../../../../lib/skills-sh.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

function parseQuery(searchParams) {
  const query = (searchParams.get('query') ?? searchParams.get('q') ?? '').trim();
  if (!query) {
    return { error: { success: false, error: 'Parameter query wajib diisi' }, status: 400 };
  }
  if (query.length < 2) {
    return { error: { success: false, error: 'Query minimal 2 karakter' }, status: 400 };
  }
  if (query.length > 200) {
    return { error: { success: false, error: 'Query terlalu panjang (maks 200 karakter)' }, status: 400 };
  }

  const rawLimit = searchParams.get('limit') ?? searchParams.get('count') ?? '10';
  let limit = parseInt(rawLimit, 10);
  if (Number.isNaN(limit)) limit = 10;
  limit = Math.min(Math.max(limit, 1), 20);

  const owner = (searchParams.get('owner') || '').trim() || undefined;

  return { params: { query, limit, owner } };
}

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const parsed = parseQuery(searchParams);
  if (parsed.error) {
    return Response.json(parsed.error, { status: parsed.status });
  }
  try {
    const result = await searchSkills(parsed.params.query, {
      limit: parsed.params.limit,
      owner: parsed.params.owner,
    });
    return Response.json({ success: true, status: 'success', ...result });
  } catch (err) {
    const status = err?.status === 404 ? 404 : 502;
    return Response.json({ success: false, status: 'error', error: err.message, httpStatus: status }, { status });
  }
}

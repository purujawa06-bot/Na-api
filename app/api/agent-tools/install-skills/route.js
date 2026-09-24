/**
 * @title Install Agent Skills
 * @summary Validasi skill + panduan install npx skills add per-agent.
 * @description Resolver untuk `npx skills add <owner/repo> --skill <nama>`: memvalidasi
 *              repo sumber via GitHub API, memastikan nama skill ada (frontmatter
 *              SKILL.md), lalu mengembalikan perintah install siap salin beserta
 *              path folder skills tiap agent (claude-code, cursor, codex, opencode,
 *              dsb). Install asli tetap dijalankan di mesin client karena CLI butuh
 *              akses tulis ke folder agent lokal — endpoint ini tidak bisa install
 *              langsung dari server. Jika nama skill tidak cocok, respons 404 berisi
 *              daftar skill yang tersedia di repo tersebut. Juga mendukung method
 *              POST dengan body JSON {"source": "...", "skill": "...", "agent": "..."}.
 * @method GET
 * @path /api/agent-tools/install-skills
 * @param {string} query.source - Repo sumber format owner/repo, mis. vercel-labs/agent-skills (wajib).
 * @param {string} query.skill - Nama skill, mis. web-design-guidelines (wajib).
 * @param {string} [query.agent] - Target agent: claude-code | cursor | codex | opencode | windsurf | gemini-cli | github-copilot | cline | kiro-cli | roo | trae | amp.
 * @response json
 * @example
 * fetch('https://puruboy-api.vercel.app/api/agent-tools/install-skills?source=vercel-labs%2Fagent-skills&skill=web-design-guidelines&agent=opencode')
 *     .then(res => res.json())
 *     .then(data => console.log(data));
 */
import { getRepoSkills, buildInstallCommand, AGENT_SKILL_PATHS } from '../../../../lib/skills-sh.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

const VALID_AGENTS = Object.keys(AGENT_SKILL_PATHS);

function parseParams(input) {
  const source = String(input.source ?? '').trim();
  const skill = String(input.skill ?? '').trim();
  const agent = String(input.agent ?? '').trim().toLowerCase() || undefined;

  if (!source) {
    return { error: { success: false, error: 'Parameter source wajib diisi (format owner/repo)' }, status: 400 };
  }
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(source)) {
    return { error: { success: false, error: "Format source tidak valid (gunakan owner/repo, mis. vercel-labs/agent-skills)" }, status: 400 };
  }
  if (!skill) {
    return { error: { success: false, error: 'Parameter skill wajib diisi (nama skill)' }, status: 400 };
  }
  if (agent && !VALID_AGENTS.includes(agent)) {
    return { error: { success: false, error: `Agent tidak dikenal. Pilihan: ${VALID_AGENTS.join(', ')}` }, status: 400 };
  }
  return { params: { source, skill, agent } };
}

async function runInstall({ source, skill, agent }) {
  const repo = await getRepoSkills(source);
  const found = repo.skills.find((s) => s.name.toLowerCase() === skill.toLowerCase());

  if (!found) {
    return Response.json(
      {
        success: false,
        status: 'not_found',
        error: `Skill "${skill}" tidak ditemukan di repo ${repo.source}`,
        available_skills: repo.skills.map((s) => s.name),
        hint: 'Pilih salah satu available_skills lalu ulangi request dengan nama yang tepat',
      },
      { status: 404 }
    );
  }

  const installCommand = buildInstallCommand(repo.source, found.name, agent);
  return Response.json({
    success: true,
    status: 'success',
    source: repo.source,
    skill: found.name,
    description: found.description,
    skill_path: found.path,
    skill_url: `https://skills.sh/${repo.source}/${found.name}`,
    install_command: installCommand,
    steps: [
      `Jalankan di terminal mesin kamu: ${installCommand}`,
      'Pilih scope project (folder agent di repo) atau global (~/.config/...) saat CLI bertanya, atau tambah flag -g untuk global.',
      'Restart agent agar skill dimuat, lalu minta agent memakai skill tersebut.',
    ],
    agent: agent || null,
    agent_skill_paths: agent ? { [agent]: AGENT_SKILL_PATHS[agent] } : AGENT_SKILL_PATHS,
    note: 'Install berjalan di mesin client (butuh akses folder agent lokal), endpoint ini hanya validasi + panduan.',
  });
}

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const parsed = parseParams({
    source: searchParams.get('source'),
    skill: searchParams.get('skill'),
    agent: searchParams.get('agent'),
  });
  if (parsed.error) {
    return Response.json(parsed.error, { status: parsed.status });
  }
  try {
    return await runInstall(parsed.params);
  } catch (err) {
    const status = err?.status === 404 ? 404 : 502;
    return Response.json({ success: false, status: 'error', error: err.message, httpStatus: status }, { status });
  }
}

export async function POST(req) {
  let body;
  try {
    body = await req.json();
  } catch {
    return Response.json({ success: false, error: 'Body harus JSON: {"source": "owner/repo", "skill": "...", "agent": "..."}' }, { status: 400 });
  }
  const parsed = parseParams(body ?? {});
  if (parsed.error) {
    return Response.json(parsed.error, { status: parsed.status });
  }
  try {
    return await runInstall(parsed.params);
  } catch (err) {
    const status = err?.status === 404 ? 404 : 502;
    return Response.json({ success: false, status: 'error', error: err.message, httpStatus: status }, { status });
  }
}

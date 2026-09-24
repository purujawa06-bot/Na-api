/**
 * @title Install Agent Skills
 * @summary Ambil file SKILL.md langsung (setara npx skills use).
 * @description Mengambil isi file SKILL.md satu skill langsung sebagai respons
 *              markdown (Content-Type text/markdown) — setara `npx skills use
 *              <owner/repo@skill>` — sehingga agent bisa membaca & memakai skill
 *              tanpa install ke folder lokal. Repo sumber divalidasi via GitHub
 *              API dan nama skill dicocokkan dengan frontmatter SKILL.md. Jika
 *              nama skill tidak cocok, respons 404 JSON berisi daftar skill yang
 *              tersedia di repo tersebut. Untuk install permanen ke folder agent,
 *              jalankan perintah pada header X-Install-Command di mesin client.
 *              Juga mendukung method POST dengan body JSON {"source": "...", "skill": "..."}.
 * @method GET
 * @path /api/agent-tools/install-skills
 * @param {string} query.source - Repo sumber format owner/repo, mis. vercel-labs/agent-skills (wajib).
 * @param {string} query.skill - Nama skill, mis. web-design-guidelines (wajib).
 * @response json
 * @example
 * fetch('https://puruboy-api.vercel.app/api/agent-tools/install-skills?source=vercel-labs%2Fagent-skills&skill=web-design-guidelines')
 *     .then(res => res.text())
 *     .then(data => console.log(data));
 */
import { getSkillFile } from '../../../../lib/skills-sh.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

function parseParams(input) {
  const source = String(input.source ?? '').trim();
  const skill = String(input.skill ?? '').trim();

  if (!source) {
    return { error: { success: false, error: 'Parameter source wajib diisi (format owner/repo)' }, status: 400 };
  }
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(source)) {
    return { error: { success: false, error: "Format source tidak valid (gunakan owner/repo, mis. vercel-labs/agent-skills)" }, status: 400 };
  }
  if (!skill) {
    return { error: { success: false, error: 'Parameter skill wajib diisi (nama skill)' }, status: 400 };
  }
  return { params: { source, skill } };
}

async function runInstall({ source, skill }) {
  try {
    const file = await getSkillFile(source, skill);
    return new Response(file.markdown, {
      status: 200,
      headers: {
        'Content-Type': 'text/markdown; charset=utf-8',
        'X-Skill-Name': file.name,
        'X-Skill-Source': file.source,
        'X-Skill-Url': file.skill_url,
        'X-Install-Command': file.install_command,
      },
    });
  } catch (err) {
    if (err?.status === 404 && err?.available) {
      return Response.json(
        {
          success: false,
          status: 'not_found',
          error: err.message,
          available_skills: err.available,
          hint: 'Pilih salah satu available_skills lalu ulangi request dengan nama yang tepat',
        },
        { status: 404 }
      );
    }
    const status = err?.status === 404 ? 404 : 502;
    return Response.json({ success: false, status: 'error', error: err.message, httpStatus: status }, { status });
  }
}

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const parsed = parseParams({
    source: searchParams.get('source'),
    skill: searchParams.get('skill'),
  });
  if (parsed.error) {
    return Response.json(parsed.error, { status: parsed.status });
  }
  return runInstall(parsed.params);
}

export async function POST(req) {
  let body;
  try {
    body = await req.json();
  } catch {
    return Response.json({ success: false, error: 'Body harus JSON: {"source": "owner/repo", "skill": "..."}' }, { status: 400 });
  }
  const parsed = parseParams(body ?? {});
  if (parsed.error) {
    return Response.json(parsed.error, { status: parsed.status });
  }
  return runInstall(parsed.params);
}

/**
 * Client untuk ekosistem open agent skills (npx skills / skills.sh).
 *
 * Reverse engineering dari CLI vercel-labs/skills (src/find.ts):
 *   - `npx skills find <query>` -> GET https://skills.sh/api/search?q=<query>&limit=20[&owner=...]
 *     respons: { query, skills: [{ id, source, skillId, name, installs }], count }
 *     (id = slug untuk URL https://skills.sh/<slug>)
 *   - `npx skills add <owner/repo> [--skill <nama>]` -> clone git repo lalu
 *     cari SKILL.md (frontmatter name + description), lalu symlink/copy ke
 *     folder skills milik agent. Install berjalan di MESIN CLIENT, jadi endpoint
 *     /api/agent-tools/install-skills bersifat resolver + panduan: memvalidasi
 *     repo/skill via GitHub API lalu mengembalikan perintah install per-agent.
 */

const SKILLS_API_BASE = 'https://skills.sh';
const GITHUB_API_BASE = 'https://api.github.com';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/** Path folder skills per-agent (dari README vercel-labs/skills). */
export const AGENT_SKILL_PATHS = {
  'claude-code': { project: '.claude/skills/', global: '~/.claude/skills/' },
  cursor: { project: '.agents/skills/', global: '~/.cursor/skills/' },
  codex: { project: '.agents/skills/', global: '~/.codex/skills/' },
  opencode: { project: '.agents/skills/', global: '~/.config/opencode/skills/' },
  windsurf: { project: '.windsurf/skills/', global: '~/.codeium/windsurf/skills/' },
  'gemini-cli': { project: '.agents/skills/', global: '~/.gemini/skills/' },
  'github-copilot': { project: '.agents/skills/', global: '~/.copilot/skills/' },
  cline: { project: '.agents/skills/', global: '~/.agents/skills/' },
  'kiro-cli': { project: '.kiro/skills/', global: '~/.kiro/skills/' },
  roo: { project: '.roo/skills/', global: '~/.roo/skills/' },
  trae: { project: '.trae/skills/', global: '~/.trae/skills/' },
  amp: { project: '.agents/skills/', global: '~/.config/agents/skills/' },
};

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchJson(url, { retries = 2 } = {}) {
  let lastErr;
  for (let attempt = 1; attempt <= retries + 1; attempt++) {
    try {
      const headers = { 'user-agent': UA, accept: 'application/json' };
      if (process.env.GITHUB_TOKEN && url.startsWith(GITHUB_API_BASE)) {
        headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
      }
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
      if (res.status === 429 || res.status >= 500) {
        throw new Error(`HTTP ${res.status}`);
      }
      if (res.status === 404) {
        const e = new Error('Tidak ditemukan (404)');
        e.status = 404;
        throw e;
      }
      if (!res.ok) {
        const e = new Error(`HTTP ${res.status}`);
        e.status = res.status;
        throw e;
      }
      return await res.json();
    } catch (e) {
      lastErr = e;
      if (e.status === 404 || attempt > retries) break;
      await delay(800 * attempt);
    }
  }
  throw lastErr || new Error('Gagal menghubungi upstream');
}

function sanitize(str) {
  return String(str ?? '').replace(/[\x00-\x1f\x7f]/g, '').slice(0, 200);
}

/**
 * Cari skills di direktori skills.sh (setara `npx skills find <query>`).
 * @param {string} query - kata kunci (min 2 karakter, ikut aturan CLI)
 * @param {object} [opts]
 * @param {number} [opts.limit=10] - jumlah hasil (1-20)
 * @param {string} [opts.owner] - filter owner GitHub (setara --owner)
 */
export async function searchSkills(query, opts = {}) {
  if (!query || typeof query !== 'string' || query.trim().length < 2) {
    throw new Error("Parameter 'query' wajib diisi (min 2 karakter).");
  }
  const limit = Math.min(Math.max(parseInt(opts.limit) || 10, 1), 20);
  const params = new URLSearchParams({ q: query.trim(), limit: String(limit) });
  if (opts.owner && typeof opts.owner === 'string' && /^[a-z0-9](?:[a-z0-9-]{0,38})$/i.test(opts.owner.trim())) {
    params.set('owner', opts.owner.trim().toLowerCase());
  }
  const data = await fetchJson(`${SKILLS_API_BASE}/api/search?${params.toString()}`);
  const skills = Array.isArray(data.skills) ? data.skills : [];
  const results = skills.map((s) => {
    const source = sanitize(s.source);
    const name = sanitize(s.name);
    const slug = sanitize(s.id);
    return {
      name,
      skill: sanitize(s.skillId || name),
      source,
      installs: Number(s.installs) || 0,
      install_command: `npx skills add ${source} --skill ${name}`,
      url: slug ? `https://skills.sh/${slug}` : 'https://skills.sh',
    };
  });
  return {
    source: 'skills.sh',
    query: query.trim(),
    limit,
    result_count: results.length,
    results,
  };
}

/** Parse frontmatter YAML minimal (name + description) dari isi SKILL.md. */
function parseSkillFrontmatter(md) {
  const m = String(md || '').match(/^---\s*\n([\s\S]*?)\n---/);
  if (!m) return {};
  const out = {};
  const name = m[1].match(/^name\s*:\s*(.+?)\s*$/m);
  const desc = m[1].match(/^description\s*:\s*(.+?)\s*$/m);
  if (name) out.name = name[1].replace(/^['"]|['"]$/g, '').trim();
  if (desc) out.description = desc[1].replace(/^['"]|['"]$/g, '').trim();
  return out;
}

/**
 * Daftar skills dalam satu repo GitHub (setara `npx skills add <source> --list`).
 * Memakai GitHub git-trees API (rekursif) lalu mengambil SKILL.md tiap kandidat
 * untuk membaca frontmatter name/description.
 */
export async function getRepoSkills(source) {
  const match = String(source || '').trim().match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/);
  if (!match) {
    throw new Error("Parameter 'source' harus format owner/repo (mis. vercel-labs/agent-skills).");
  }
  const [, owner, repo] = match;

  // Coba branch main lalu master.
  let tree = null;
  for (const branch of ['main', 'master']) {
    try {
      tree = await fetchJson(`${GITHUB_API_BASE}/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`);
      break;
    } catch (e) {
      if (e.status === 404) continue;
      throw e;
    }
  }
  if (!tree) {
    const e = new Error(`Repo ${owner}/${repo} tidak ditemukan di GitHub.`);
    e.status = 404;
    throw e;
  }

  const skillFiles = (tree.tree || []).filter(
    (n) => n.type === 'blob' && /(^|\/)SKILL\.md$/i.test(n.path || '')
  );

  // Batasi fetch SKILL.md agar tetap ringan di serverless (maks 30 file).
  const limited = skillFiles.slice(0, 30);
  const skills = [];
  for (const f of limited) {
    try {
      const blob = await fetchJson(`${GITHUB_API_BASE}/repos/${owner}/${repo}/contents/${f.path}`);
      const content = blob.content
        ? Buffer.from(blob.content.replace(/\n/g, ''), 'base64').toString('utf-8')
        : '';
      const fm = parseSkillFrontmatter(content);
      const dir = f.path.replace(/\/SKILL\.md$/i, '');
      skills.push({
        name: fm.name || dir.split('/').pop(),
        description: fm.description || null,
        path: f.path,
      });
    } catch {
      /* satu file gagal -> lewati */
    }
  }
  return {
    source: `${owner}/${repo}`,
    truncated: skillFiles.length > limited.length,
    skills,
  };
}

/** Bangun perintah install `npx skills add` untuk satu skill + agent opsional. */
export function buildInstallCommand(source, skill, agent) {
  let cmd = `npx skills add ${source} --skill ${skill}`;
  if (agent && AGENT_SKILL_PATHS[agent]) cmd += ` -a ${agent}`;
  return cmd;
}

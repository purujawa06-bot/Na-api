/**
 * UserScript GitHub Store — userScript disimpan sebagai file `.user.js` di
 * repo GitHub (purujawa06-bot/pageku, folder `userscripts/`). Menambah script
 * cukup dengan upload file `.user.js` ke folder tersebut; metadata diambil dari
 * header ==UserScript== (label @name, @description, @version, dst), tidak ada
 * data hardcoded lagi di kode aplikasi.
 */

const REPO = 'purujawa06-bot/pageku';
const DIR = 'userscripts';

export async function listUserScriptFiles() {
  const token = process.env.GITHUB_TOKEN;
  const res = await fetch(`https://api.github.com/repos/${REPO}/contents/${DIR}`, {
    headers: token ? { Authorization: `token ${token}` } : {},
    next: { revalidate: 60 },
  });
  if (!res.ok) return [];
  const files = await res.json();
  if (!Array.isArray(files)) return [];
  return files
    .filter((f) => f.name.endsWith('.user.js'))
    .sort((a, b) => b.name.localeCompare(a.name));
}

export async function getUserScriptRaw(file) {
  const res = await fetch(`https://raw.githubusercontent.com/${REPO}/main/${DIR}/${encodeURIComponent(file)}`, {
    cache: 'no-store',
  });
  if (!res.ok) return null;
  return res.text();
}

export function parseUserScriptMeta(content) {
  const block = content.match(/\/\/ ==UserScript==([\s\S]*?)\/\/ ==\/UserScript==/);
  if (!block) return { name: 'Untitled', version: '0.0.0', author: '-' };
  const meta = {};
  const get = (label) => {
    const m = block[1].match(new RegExp(`//\\s*@${label}\\s+(.+)$`, 'm'));
    return m ? m[1].trim() : '';
  };
  meta.name = get('name') || 'Untitled';
  meta.description = get('description');
  meta.version = get('version') || '0.0.0';
  meta.author = get('author') || '-';
  meta.match = get('match');
  meta.icon = get('icon');
  return meta;
}
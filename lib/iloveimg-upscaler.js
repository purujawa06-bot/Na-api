/**
 * Client iloveimg.com — upscale gambar.
 * Reverse engineering 100% (tanpa hardcode token/task):
 *   `taskId` & `token` (authorization) di-generate server dan disuntikkan ke
 *   HTML halaman. Kita ambil dinamis setiap panggilan, lalu:
 *   1. POST /v1/upload  -> kirim file + task, dapat server_filename.
 *   2. POST /v1/upscale -> kirim task + server_filename + scale, dapat PNG.
 */

const PAGE = 'https://www.iloveimg.com/upscale-image';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36';

/** Ambil token auth + taskId + server worker dari halaman upscale-image. */
async function getSession() {
  const res = await fetch(PAGE, { headers: { 'user-agent': UA } });
  if (!res.ok) throw new Error(`Gagal ambil halaman iloveimg (HTTP ${res.status})`);
  const html = await res.text();

  const token = (html.match(/"token":"([^"]+)"/) || [])[1];
  const taskId = (html.match(/ilovepdfConfig\.taskId\s*=\s*'([^']+)'/) || [])[1];
  if (!token || !taskId) throw new Error('Token/taskId tidak ditemukan di halaman iloveimg');

  const serversRaw = (html.match(/"servers":(\[[^\]]*\])/) || [])[1];
  let servers = [];
  try { servers = JSON.parse(serversRaw || '[]'); } catch {}
  const server = servers[0] || 'api1g';

  return { token, taskId, server };
}

export async function upscaleImage(file, scale = 2) {
  const { token, taskId, server } = await getSession();
  const filename = file.name || 'image.png';
  const api = `https://${server}.iloveimg.com/v1`;
  const headers = (extra = {}) => ({
    'user-agent': UA,
    accept: 'application/json',
    authorization: `Bearer ${token}`,
    referer: 'https://www.iloveimg.com/',
    ...extra,
  });

  // 1. Upload
  const uploadForm = new FormData();
  uploadForm.append('task', taskId);
  uploadForm.append('file', file, filename);
  const upRes = await fetch(`${api}/upload`, { method: 'POST', headers: headers(), body: uploadForm });
  if (!upRes.ok) throw new Error(`Upload gagal (HTTP ${upRes.status})`);
  const { server_filename } = await upRes.json();
  if (!server_filename) throw new Error('server_filename tidak ditemukan dari respons upload');

  // 2. Upscale
  const upForm = new FormData();
  upForm.append('task', taskId);
  upForm.append('server_filename', server_filename);
  upForm.append('scale', String(scale));
  const scRes = await fetch(`${api}/upscale`, {
    method: 'POST',
    headers: headers({ accept: '*/*' }),
    body: upForm,
  });
  if (!scRes.ok) throw new Error(`Upscale gagal (HTTP ${scRes.status})`);

  const buffer = Buffer.from(await scRes.arrayBuffer());
  return { buffer, mimetype: scRes.headers.get('content-type') || 'image/png', filename };
}

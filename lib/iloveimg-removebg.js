/**
 * Client iloveimg.com — remove background (hapus latar belakang).
 * Reverse engineering (pola sama dengan upscaler):
 *   `taskId` & `token` (authorization) disuntikkan ke HTML halaman; kita ambil
 *   dinamis tiap panggilan, lalu:
 *   1. POST /v1/upload  -> kirim file + task, dapat server_filename.
 *   2. POST /v1/removebackground -> kirim task + server_filename, langsung
 *      dapat PNG (latar transparan). Tanpa polling.
 */

const PAGE = 'https://www.iloveimg.com/remove-background';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36';

/** Ambil token auth + taskId + server worker dari halaman remove-background. */
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

/** Unduh gambar dari URL publik menjadi Blob. */
async function downloadImage(url) {
  const res = await fetch(url, { headers: { 'user-agent': UA } });
  if (!res.ok) throw new Error(`Gagal mengunduh gambar (HTTP ${res.status})`);
  return await res.blob();
}

/**
 * Hapus latar belakang gambar via iloveimg.
 * @param {string} url - URL publik gambar (md/jpg/webp/dll).
 * @returns {Promise<{buffer:Buffer, mimetype:string, filename:string}>}
 */
export async function removeBackground(url) {
  const { token, taskId, server } = await getSession();
  const blob = await downloadImage(url);
  const file = new Blob([blob], { type: blob.type });
  let filename = url.split('/').pop().split('?')[0] || 'image';
  const extMatch = /\.(png|jpe?g|webp|gif|bmp)$/i.exec(filename);
  if (!extMatch) {
    const extByType = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' }[blob.type] || 'png';
    filename = `${filename.split('.')[0] || 'image'}.${extByType}`;
  }
  file.name = filename;
  const api = `https://${server}.iloveimg.com/v1`;
  const headers = () => ({
    'user-agent': UA,
    accept: 'application/json',
    authorization: `Bearer ${token}`,
    referer: 'https://www.iloveimg.com/',
  });

  // 1. Upload
  const uploadForm = new FormData();
  uploadForm.append('task', taskId);
  uploadForm.append('file', file, filename);
  const upRes = await fetch(`${api}/upload`, { method: 'POST', headers: headers(), body: uploadForm });
  if (!upRes.ok) throw new Error(`Upload gagal (HTTP ${upRes.status}): ${await upRes.text()}`);
  const { server_filename } = await upRes.json();
  if (!server_filename) throw new Error('server_filename tidak ditemukan dari respons upload');

  // 2. Remove background -> langsung dapat PNG transparan
  const rbForm = new FormData();
  rbForm.append('task', taskId);
  rbForm.append('server_filename', server_filename);
  const rbRes = await fetch(`${api}/removebackground`, {
    method: 'POST',
    headers: headers(),
    body: rbForm,
  });
  if (!rbRes.ok) throw new Error(`Remove background gagal (HTTP ${rbRes.status})`);

  const buffer = Buffer.from(await rbRes.arrayBuffer());
  const resultName = `${filename.split('.')[0]}_nobg.png`;
  return { buffer, mimetype: 'image/png', filename: resultName };
}

/**
 * Client iloveimg.com — HTML to Image.
 * Reverse engineering 100% (tanpa hardcode token/task):
 *   `taskId` & `token` (authorization) di-generate server & disuntikkan ke
 *   HTML halaman. Kita ambil dinamis tiap panggilan, lalu:
 *   1. POST /v1/upload  -> kirim task + cloud_file (URL web), dapat server_filename (.url).
 *   2. POST /v1/process -> task + tool:htmlimage + url + view_width + to_format,
 *      dapat file gambar di <server>/v1/download/<task>.
 */

const PAGE = 'https://www.iloveimg.com/html-to-image';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36';

/** Ambil token auth + taskId + worker server dari halaman html-to-image. */
async function getSession() {
  const res = await fetch(PAGE, { headers: { 'user-agent': UA } });
  if (!res.ok) throw new Error(`Gagal ambil halaman iloveimg (HTTP ${res.status})`);
  const html = await res.text();

  const token = (html.match(/"token":"([^"]+)"/) || [])[1];
  const taskId = (html.match(/ilovepdfConfig\.taskId\s*=\s*'([^']+)'/) || [])[1];
  if (!token || !taskId) throw new Error('Token/taskId tidak ditemukan di halaman iloveimg');

  let server = 'api32.ilovepdf.com';
  const serversRaw = (html.match(/"servers":(\[[^\]]*\])/) || [])[1];
  try {
    const servers = JSON.parse(serversRaw || '[]');
    if (servers[0]) server = servers[0];
  } catch {}
  if (!server.includes('.') && !server.startsWith('http')) server = `${server}.iloveimg.com`;
  if (!server.startsWith('http')) server = `https://${server}`;

  return { token, taskId, server: server.replace(/\/+$/, '') };
}

/**
 * Konversi halaman web/URL menjadi gambar via iloveimg.
 * @param {string} url - URL publik web/HTML yang ingin dijadikan gambar.
 * @param {object} opts - { viewWidth?, toFormat? }.
 * @returns {Promise<{buffer:Buffer, mimetype:string, filename:string}>}
 */
export async function htmlToImage(url, opts = {}) {
  const { token, taskId, server } = await getSession();
  const viewWidth = opts.viewWidth || 1920;
  const toFormat = (opts.toFormat || 'jpg').toLowerCase();
  const host = new URL(url).hostname.replace(/[^\w.-]/g, '_') || 'webpage';

  const api = `${server}/v1`;
  const headers = (extra = {}) => ({
    'user-agent': UA,
    accept: 'application/json',
    authorization: `Bearer ${token}`,
    referer: 'https://www.iloveimg.com/',
    ...extra,
  });

  // 1. Upload URL web
  const upForm = new FormData();
  upForm.append('task', taskId);
  upForm.append('cloud_file', url);
  const upRes = await fetch(`${api}/upload`, { method: 'POST', headers: headers(), body: upForm });
  if (!upRes.ok) throw new Error(`Upload gagal (HTTP ${upRes.status}): ${await upRes.text()}`);
  const upJson = await upRes.json();
  const serverFilename = upJson.server_filename;
  if (!serverFilename) throw new Error('server_filename tidak ditemukan dari respons upload');

  // 2. Process konversi
  const fn = new FormData();
  fn.append('url', url);
  fn.append('view_width', String(viewWidth));
  fn.append('to_format', toFormat);
  fn.append('block_ads', 'false');
  fn.append('remove_popups', 'false');
  fn.append('task', taskId);
  fn.append('tool', 'htmlimage');
  fn.append('packaged_filename', 'iloveimg-htmled');
  fn.append('files[0][server_filename]', serverFilename);
  fn.append('files[0][filename]', host);
  fn.append('files[0][processed]', 'true');
  const prRes = await fetch(`${api}/process`, { method: 'POST', headers: headers(), body: fn });
  if (!prRes.ok) throw new Error(`Process gagal (HTTP ${prRes.status}): ${await prRes.text()}`);

  // 3. Download hasil file gambar (tunggu sebentar agar file siap)
  await new Promise((r) => setTimeout(r, 1500));
  let dlRes = await fetch(`${api}/download/${taskId}`, {
    headers: { 'user-agent': UA, authorization: `Bearer ${token}`, referer: 'https://www.iloveimg.com/' },
  });
  let dlCounter = 0;
  while (!dlRes.ok && dlCounter < 5) {
    dlRes = await fetch(`${api}/download/${taskId}`, {
      headers: { 'user-agent': UA, authorization: `Bearer ${token}`, referer: 'https://www.iloveimg.com/' },
    });
    dlCounter++;
    await new Promise((r) => setTimeout(r, 1500));
  }
  if (!dlRes.ok) throw new Error(`Download hasil gagal (HTTP ${dlRes.status})`);

  const ct = dlRes.headers.get('content-type') || 'image/jpeg';
  const buffer = Buffer.from(await dlRes.arrayBuffer());
  const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/svg+xml': 'svg' }[ct] || toFormat;
  return { buffer, mimetype: ct, filename: `${host}.${ext}` };
}
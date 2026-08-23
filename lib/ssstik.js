/**
 * Client ssstik.io — download video TikTok tanpa watermark.
 * Alur (hasil reverse-engineering via CDP):
 *   1. GET https://ssstik.io/id  -> ambil token `tt` dari script inline.
 *   2. GET https://ssstik.io/cdn-cgi/trace -> ip & loc (untuk param debug).
 *   3. POST /abc?url=dl (htmx) dengan form id/locale/tt/debug -> HTML hasil.
 *   4. Parse link download tanpa watermark + mp3 + metadata.
 */

const BASE = 'https://ssstik.io';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36';

function esc(s) {
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'");
}

async function getTrace() {
  const res = await fetch(`${BASE}/cdn-cgi/trace`, { headers: { 'user-agent': UA } });
  const body = await res.text();
  const ip = (body.match(/^ip=(.*)$/m) || [])[1];
  const loc = (body.match(/^loc=(.*)$/m) || [])[1];
  return { ip, loc };
}

async function getPageToken() {
  const res = await fetch(`${BASE}/id`, {
    headers: { 'user-agent': UA, 'accept-language': 'id-ID,id;q=0.9,en;q=0.8' },
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`Gagal ambil halaman ssstik.io (HTTP ${res.status})`);
  const html = await res.text();
  const tt = (html.match(/tt\s*=\s*'([^']+)'/) || [])[1];
  if (!tt) throw new Error('Token tt tidak ditemukan di halaman ssstik.io');
  return tt;
}

async function postDownload(tiktokUrl, tt, trace) {
  const body = new URLSearchParams({
    id: tiktokUrl,
    locale: 'id',
    tt,
    debug: `ab=1&loc=${trace.loc || 'US'}&ip=${trace.ip || ''}`,
  });
  const res = await fetch(`${BASE}/abc?url=dl`, {
    method: 'POST',
    headers: {
      'user-agent': UA,
      'accept': '*/*',
      'content-type': 'application/x-www-form-urlencoded',
      'referer': `${BASE}/id`,
      'hx-request': 'true',
      'hx-trigger': '_gcaptcha_pt',
      'hx-target': 'target',
      'hx-current-url': `${BASE}/id`,
    },
    body,
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`ssstik.io gagal memproses (HTTP ${res.status})`);
  return res.text();
}

function parseResult(html) {
  const video = (html.match(/href="(https:\/\/tikcdn\.io\/ssstik\/\d+[^"]*)"\s*class="[^"]*without_watermark[^"]*"/) || [])[1];
  const mp3 = (html.match(/href="(https:\/\/tikcdn\.io\/ssstik\/m\/[^"]+)"/) || [])[1];
  const author = (html.match(/<h2>([^<]+)<\/h2>/) || [])[1];
  const avatar = (html.match(/<img class="result_author" src="([^"]+)"/) || [])[1];
  const captionRaw = (html.match(/<p class="maintext">([\s\S]*?)<\/p>/) || [])[1];

  const expires = video ? parseInt((video.match(/[?&]e=(\d+)/) || [])[1], 10) : null;

  return {
    author: author ? esc(author.trim()) : null,
    avatar: avatar || null,
    caption: captionRaw ? esc(captionRaw.trim()) : null,
    video_url: video || null,
    video_expires: expires,
    mp3_url: mp3 || null,
  };
}

export async function downloadTiktok(tiktokUrl) {
  const [tt, trace] = await Promise.all([getPageToken(), getTrace()]);
  const html = await postDownload(tiktokUrl, tt, trace);
  const result = parseResult(html);
  if (!result.video_url) {
    const errText = (html.match(/<p[^>]*class="[^"]*(?:err|alert|error)[^"]*"[^>]*>([\s\S]*?)<\/p>/i) || [])[1];
    throw new Error(errText ? `Video tidak bisa diunduh: ${esc(errText.trim())}` : 'Video tidak ditemukan atau tidak bisa diunduh');
  }
  return result;
}

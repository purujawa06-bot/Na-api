/**
 * Client instasave.website — download media Instagram (Reels, Post, IGTV, Carousel).
 * Alur (hasil reverse-engineering):
 *   1. Ekstrak shortcode dari URL Instagram (/p/, /reel/, /reels/, /tv/).
 *   2. Bangun URL GraphQL IG klasik dengan query_hash shortcode-media.
 *   3. POST keduanya ke api.instasave.website/media -> server mereka fetch ke IG.
 *   4. Respons berupa fragmen JS/HTML berisi link cdn.instasave.website/?token=<JWT>.
 *   5. Decode payload JWT untuk mendapat URL asli CDN Instagram + nama file.
 * Catatan: link CDN Instagram kedaluwarsa ±1 jam (param oe/exp di URL).
 */

const API_MEDIA = 'https://api.instasave.website/media';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36';
const QUERY_HASH = '2b0673e0dc4580674a88d426fe00ea90';

function decodeXEscapes(s) {
  return s.replace(/\\x([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

function decodeJwtPayload(jwt) {
  try {
    const part = jwt.split('.')[1];
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
    const json = Buffer.from(b64, 'base64').toString('utf8');
    return JSON.parse(json);
  } catch {
    return null;
  }
}

export function extractShortcode(url) {
  const m = url.match(/instagram\.com\/(?:[^/?#]+\/)?(?:reels?|p|tv)\/([A-Za-z0-9_-]+)/i);
  return m ? m[1] : null;
}

async function resolveShareUrl(url) {
  try {
    const res = await fetch(url, { method: 'HEAD', redirect: 'follow', headers: { 'user-agent': UA } });
    return res.url || url;
  } catch {
    return url;
  }
}

function extOf(filename) {
  const m = filename.match(/\.([a-z0-9]{2,5})$/i);
  return m ? m[1].toLowerCase() : '';
}

async function callInstasave(shortcode, originalUrl) {
  const gqlUrl =
    'https://www.instagram.com/graphql/query?query_hash=' + QUERY_HASH +
    '&variables={"shortcode":"' + shortcode + '"}';
  const res = await fetch(API_MEDIA, {
    method: 'POST',
    headers: {
      'user-agent': UA,
      'content-type': 'application/x-www-form-urlencoded',
      referer: 'https://instasave.website/',
      origin: 'https://instasave.website',
      accept: 'application/json, text/plain, */*',
    },
    body: new URLSearchParams({ url: originalUrl, instaLink: gqlUrl }).toString(),
    signal: AbortSignal.timeout(25000),
  });
  if (!res.ok) throw new Error(`instasave.website menolak permintaan (HTTP ${res.status})`);
  return decodeXEscapes(await res.text());
}

function parseMedias(fragment) {
  const seen = new Set();
  const medias = [];
  const re = /token=([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*)/g;
  let m;
  while ((m = re.exec(fragment))) {
    const payload = decodeJwtPayload(m[1]);
    if (!payload || !payload.url || seen.has(payload.url)) continue;
    seen.add(payload.url);
    const ext = extOf(payload.filename || payload.url);
    const kind = ext === 'mp4' ? 'video' : ['jpg', 'jpeg', 'png', 'webp'].includes(ext) ? 'image' : 'other';
    if (kind === 'other') continue;
    medias.push({
      type: kind,
      ext,
      filename: payload.filename || null,
      url: payload.url,
      proxy_url: 'https://cdn.instasave.website/?token=' + m[1],
      expires_at: payload.exp ? payload.exp * 1000 : null,
    });
  }
  return medias;
}

export async function downloadInstagram(instagramUrl) {
  let target = instagramUrl;
  if (/instagram\.com\/share\//i.test(target)) target = await resolveShareUrl(target);

  const shortcode = extractShortcode(target);
  if (!shortcode) throw new Error('Shortcode Instagram tidak ditemukan di URL');

  const fragment = await callInstasave(shortcode, target);
  const medias = parseMedias(fragment);
  if (!medias.length) throw new Error('Media tidak ditemukan atau akun privat');

  const videos = medias.filter((x) => x.type === 'video');
  const images = medias.filter((x) => x.type === 'image');
  const type =
    videos.length > 1 || images.length > 1 ? 'carousel' : videos.length === 1 ? 'video' : 'image';

  return {
    shortcode,
    type,
    thumbnail: images[0]?.proxy_url || null,
    video_url: videos[0]?.url || null,
    video_proxy_url: videos[0]?.proxy_url || null,
    media_count: medias.length,
    medias,
  };
}

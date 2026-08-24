/**
 * Downloader media Instagram (Reels, Post, IGTV) tanpa watermark & tanpa browser.
 *
 * Strategi (hasil reverse-engineering, Agustus 2026):
 *   1. UTAMA — embed proxy kkinstagram.com:
 *      GET https://kkinstagram.com/{p|reel|tv|reels}/<shortcode>/ dengan User-Agent
 *      bot embed (Discordbot) -> server mereka fetch IG dan 302 langsung ke file
 *      scontent.cdninstagram.com (mp4/jpg). Invalid shortcode di-redirect balik
 *      ke instagram.com; shortcode tak dikenal -> HTTP 504.
 *   2. CADANGAN — api.instasave.website/media (POST url + GraphQL URL klasik),
 *      respons fragmen JS berisi token cdn.instasave.website (JWT payload
 *      memuat URL asli CDN). Mendukung carousel. Catatan: layanan ini memblokir
 *      beberapa IP datacenter (403 dari Vercel), jadi hanya dipakai sebagai fallback.
 * Catatan umum: link CDN Instagram kedaluwarsa ±1 jam (param oe/exp di URL).
 */

const BOT_UA =
  'Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)';
const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const QUERY_HASH = '2b0673e0dc4580674a88d426fe00ea90';

export function extractShortcode(url) {
  const m = url.match(/instagram\.com\/(?:[^/?#]+\/)?(?:reels?|p|tv)\/([A-Za-z0-9_-]+)/i);
  return m ? m[1] : null;
}

async function resolveShareUrl(url) {
  try {
    const res = await fetch(url, {
      method: 'HEAD',
      redirect: 'follow',
      headers: { 'user-agent': BROWSER_UA },
      signal: AbortSignal.timeout(15000),
    });
    return res.url || url;
  } catch {
    return url;
  }
}

/* ---------------- Utama: kkinstagram embed proxy ---------------- */

function extOf(url) {
  const m = url.match(/\.(mp4|jpg|jpeg|png|webp)(?:\?|$)/i);
  return m ? m[1].toLowerCase() : '';
}

async function viaKkInstagram(shortcode) {
  // Coba path sesuai konteks; kkinstagram menormalkan /p/<code> -> /reel/ untuk
  // konten video, jadi coba /reel/ dulu lalu /p/.
  const paths = [`reel/${shortcode}`, `p/${shortcode}`, `tv/${shortcode}`];
  const tried = [];

  for (const path of paths) {
    let res;
    try {
      res = await fetch(`https://kkinstagram.com/${path}/`, {
        headers: { 'user-agent': BOT_UA },
        redirect: 'manual',
        signal: AbortSignal.timeout(30000),
      });
    } catch (err) {
      tried.push(`${path}: ${err.message}`);
      continue;
    }
    await res.text().catch(() => ''); // kosongkan body agar socket bebas

    const loc = res.headers.get('location');

    // 302 ke CDN Instagram -> media tunggal ketemu
    if (res.status >= 300 && res.status < 400 && loc && /^https?:\/\/[^/]*cdninstagram\.com/.test(loc)) {
      const ext = extOf(loc) || (loc.includes('/o1/v/') ? 'mp4' : 'jpg');
      const kind = ext === 'mp4' ? 'video' : ['jpg', 'jpeg', 'png', 'webp'].includes(ext) ? 'image' : 'other';
      if (kind === 'other') {
        tried.push(`${path}: tipe media tidak dikenali (${ext || '?'})`);
        continue;
      }
      return {
        shortcode,
        type: kind,
        media_url: loc,
        expires_note: 'Link CDN Instagram kedaluwarsa ±1 jam',
      };
    }

    // Redirect balik ke instagram.com -> shortcode valid tapi tidak bisa diproxy
    // (umumnya invalid/tidak ada). 504 -> upstream gagal mengambil.
    if (res.status === 504) {
      tried.push(`${path}: media tidak ditemukan (upstream 504)`);
    } else if (loc && /instagram\.com/.test(loc)) {
      tried.push(`${path}: shortcode tidak valid`);
      break; // tidak perlu coba path lain, shortcode sudah dinilai invalid
    } else {
      tried.push(`${path}: HTTP ${res.status}`);
    }
  }

  throw new Error(
    tried.length
      ? `kkinstagram gagal — ${tried.join('; ')}`
      : 'kkinstagram gagal'
  );
}

/* ---------------- Cadangan: instasave.website ---------------- */

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

function parseMedias(fragment) {
  const seen = new Set();
  const medias = [];
  const re = /token=([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*)/g;
  let m;
  while ((m = re.exec(fragment))) {
    const payload = decodeJwtPayload(m[1]);
    if (!payload || !payload.url || seen.has(payload.url)) continue;
    seen.add(payload.url);
    const mm = (payload.filename || payload.url).match(/\.([a-z0-9]{2,5})$/i);
    const ext = mm ? mm[1].toLowerCase() : '';
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

async function viaInstasave(shortcode, originalUrl) {
  const gqlUrl =
    'https://www.instagram.com/graphql/query?query_hash=' + QUERY_HASH +
    '&variables={"shortcode":"' + shortcode + '"}';
  let res;
  try {
    res = await fetch('https://api.instasave.website/media', {
      method: 'POST',
      headers: {
        'user-agent': BROWSER_UA,
        'content-type': 'application/x-www-form-urlencoded',
        referer: 'https://instasave.website/',
        origin: 'https://instasave.website',
        accept: 'application/json, text/plain, */*',
      },
      body: new URLSearchParams({ url: originalUrl, instaLink: gqlUrl }).toString(),
      signal: AbortSignal.timeout(25000),
    });
  } catch (err) {
    throw new Error('instasave.website tidak dapat dihubungi: ' + err.message);
  }
  if (!res.ok) throw new Error(`instasave.website menolak permintaan (HTTP ${res.status})`);
  const fragment = decodeXEscapes(await res.text());
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

/* ---------------- Publik ---------------- */

export async function downloadInstagram(instagramUrl) {
  let target = instagramUrl;
  if (/instagram\.com\/share\//i.test(target)) target = await resolveShareUrl(target);

  const shortcode = extractShortcode(target);
  if (!shortcode) throw new Error('Shortcode Instagram tidak ditemukan di URL');

  // Utama: kkinstagram (cepat, direct CDN, tapi hanya media tunggal).
  try {
    return { ...(await viaKkInstagram(shortcode)), _via: 'kkinstagram' };
  } catch (primaryErr) {
    // Fallback: instasave (dukung carousel, tapi sering blokir IP datacenter).
    try {
      return { ...(await viaInstasave(shortcode, target)), _via: 'instasave.website' };
    } catch {
      throw primaryErr; // laporkan error utama yang lebih relevan
    }
  }
}

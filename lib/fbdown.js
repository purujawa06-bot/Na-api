const axios = require('axios');

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

/**
 * Helper: extract JSON string value from raw HTML by finding key and parsing value.
 */
function extractJsonStringValue(html, key) {
  const idx = html.indexOf(`"${key}"`);
  if (idx === -1) return null;

  const colonIdx = idx + key.length + 2;
  const valStart = html.indexOf('"', colonIdx);
  if (valStart === -1) return null;

  let valEnd = valStart + 1;
  while (valEnd < html.length) {
    if (html[valEnd] === '\\') {
      valEnd += 2;
    } else if (html[valEnd] === '"') {
      break;
    } else {
      valEnd++;
    }
  }

  if (valEnd >= html.length) return null;

  const raw = html.substring(valStart, valEnd + 1);
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Helper: extract all Representation data from DASH manifest XML.
 */
function parseDashRepresentations(xml) {
  if (!xml) return [];

  const reps = [];
  const repRegex = /<Representation\s+([\s\S]*?)<\/Representation>/g;
  let m;
  while ((m = repRegex.exec(xml)) !== null) {
    const block = m[0];

    const getAttr = (name) => {
      const rm = block.match(new RegExp(`\\b${name}="([^"]*)"`));
      return rm ? rm[1] : null;
    };

    const baseUrlMatch = block.match(/<BaseURL>([^<]+)<\/BaseURL>/);
    const baseUrl = baseUrlMatch ? baseUrlMatch[1].replace(/&amp;/g, '&') : null;

    if (baseUrl) {
      reps.push({
        label: getAttr('FBQualityLabel'),
        qualityClass: getAttr('FBQualityClass'),
        bandwidth: getAttr('bandwidth') ? parseInt(getAttr('bandwidth'), 10) : null,
        width: getAttr('width') ? parseInt(getAttr('width'), 10) : null,
        height: getAttr('height') ? parseInt(getAttr('height'), 10) : null,
        codecs: getAttr('codecs'),
        mimeType: getAttr('mimeType'),
        id: getAttr('id'),
        url: baseUrl,
      });
    }
  }
  return reps;
}

/**
 * Facebook Reel/Video Scraper
 *
 * Scrapes Facebook video/reel info tanpa perlu login.
 * Menggunakan endpoint embed plugin Facebook.
 *
 * @param {string} fbUrl - URL Facebook (reel, watch, video)
 * @param {object} [options]
 * @param {boolean} [options.includeThumbnail] - Sertakan URL thumbnail (default: true)
 * @param {boolean} [options.includeSubtitles] - Sertakan URL subtitle (default: false)
 * @returns {Promise<object>}
 */
async function fbdown(fbUrl, options = {}) {
  if (!fbUrl || typeof fbUrl !== 'string') {
    throw new Error("Parameter 'url' wajib diisi.");
  }

  const includeThumbnail = options.includeThumbnail !== false;
  const includeSubtitles = options.includeSubtitles === true;
  const userAgent = options.userAgent || USER_AGENT;

  // --- Normalisasi URL ---
  let videoId = null;
  const reelMatch = fbUrl.match(/(?:reel|videos)\/(\d+)/);
  const watchMatch = fbUrl.match(/watch\/?\?v=(\d+)/);
  const directMatch = fbUrl.match(/facebook\.com\/[^/]+\/videos\/(\d+)/);

  if (reelMatch) {
    videoId = reelMatch[1];
  } else if (watchMatch) {
    videoId = watchMatch[1];
  } else if (directMatch) {
    videoId = directMatch[1];
  }

  if (!videoId) {
    throw new Error('URL tidak valid. Gunakan URL Facebook Reel atau Video (reel, watch, videos).');
  }

  // --- Fetch via embed plugin ---
  const embedUrl = `https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(fbUrl)}&show_text=0`;

  const { data: html } = await axios.get(embedUrl, {
    headers: {
      'User-Agent': userAgent,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
    },
    timeout: 30000,
  });

  const result = {
    id: videoId,
    url: fbUrl,
    video: {
      hd: null,
      sd: null,
    },
    owner: null,
    description: null,
    width: null,
    height: null,
    aspectRatio: null,
    duration: null,
    subtitles: null,
    thumbnail: null,
    formats: [],
  };

  // --- 1. Extract video JSON data (hd_src, sd_src) ---
  const hdIdx = html.indexOf('"hd_src"');
  if (hdIdx > -1) {
    const braceStart = html.lastIndexOf('{', hdIdx);
    if (braceStart >= 0) {
      let depth = 0;
      let braceEnd = braceStart;
      for (let i = braceStart; i < html.length; i++) {
        if (html[i] === '{') depth++;
        else if (html[i] === '}') depth--;
        if (depth === 0) { braceEnd = i + 1; break; }
      }
      try {
        const jsonStr = html.substring(braceStart, braceEnd);
        const videoData = JSON.parse(jsonStr);

        const unescape = (val) => val ? val.replace(/\\\//g, '/').replace(/\\"/g, '"') : null;

        result.video.hd = unescape(videoData.hd_src);
        result.video.sd = unescape(videoData.sd_src);
        result.aspectRatio = videoData.aspect_ratio || null;
        result.subtitles = unescape(videoData.subtitles_src) || null;

        if (videoData.video_id && videoData.video_id !== videoId) {
          result.id = videoData.video_id;
        }
      } catch (_) {
        // JSON parsing gagal, lanjut
      }
    }
  }

  // --- 2. Video dimensions ---
  const vidMatch = html.match(/<video[^>]*width="(\d+)"[^>]*height="(\d+)"/);
  if (vidMatch) {
    result.width = parseInt(vidMatch[1], 10);
    result.height = parseInt(vidMatch[2], 10);
  }

  // --- 3. Owner & description ---
  const canonicalMatch = html.match(/<link[^>]*rel="canonical"[^>]*href="([^"]+)"/);
  if (canonicalMatch) {
    const canonical = canonicalMatch[1];
    const parts = canonical.replace(/\/+$/, '').split('/');

    const vidIdx = parts.findIndex(p => p === 'videos' || p === 'reel' || p === 'watch');
    if (vidIdx >= 1) {
      result.owner = {
        id: parts[vidIdx - 1] || null,
        name: null,
        url: parts.slice(0, vidIdx).join('/'),
      };
    }

    const slugIdx = parts.findIndex(p => p === 'videos');
    if (slugIdx >= 0 && slugIdx + 1 < parts.length) {
      const slug = parts[slugIdx + 1];
      if (slug && slug !== videoId) {
        result.description = slug;
      }
    }
  }

  // --- 4. Thumbnail ---
  if (includeThumbnail) {
    const imgMatch = html.match(/<img[^>]*class="[^"]*_3fnw[^"]*"[^>]*src="([^"]+)"/);
    if (imgMatch) {
      result.thumbnail = imgMatch[1].replace(/&amp;/g, '&');
    } else {
      const srcMatch = html.match(/https?:\\\/\\\/scontent[^"'\s]+\.jpg[^"'\s&]*(?:&[a-z_]+=[^"'\s&]*)*/);
      if (srcMatch) {
        result.thumbnail = srcMatch[0].replace(/\\\//g, '/').replace(/&amp;/g, '&');
      }
    }
  }

  // --- 5. DASH manifest untuk formats & duration ---
  const dashXml = extractJsonStringValue(html, 'dash_manifest');
  if (dashXml) {
    const durMatch = dashXml.match(/mediaPresentationDuration="([^"]+)"/);
    if (durMatch) {
      const durStr = durMatch[1];
      const sec = parseFloat(durStr.replace('PT', '').replace('S', ''));
      if (!isNaN(sec)) {
        result.duration = sec;
      }
    }

    result.formats = parseDashRepresentations(dashXml);
  }

  // --- 6. Duration fallback ---
  if (!result.duration) {
    const durSrc = html.match(/"duration_s":(\d+)/);
    if (durSrc) {
      result.duration = parseInt(durSrc[1], 10);
    }
  }

  return result;
}

module.exports = { fbdown };

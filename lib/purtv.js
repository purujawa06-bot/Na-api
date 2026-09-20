/**
 * Client anichin.com.co — sumber data frontend purtv.vercel.app (donghua sub Indo).
 * Frontend purtv.vercel.app (SPA React) men-scrape anichin lewat proxy pihak
 * ketiga (vercel-api-beta-red) + samehadaku. Modul ini mengganti proxy tersebut:
 * scraping anichin.com.co langsung dengan cheerio (sudah jadi dependency), sehingga
 * endpoint di sini mengembalikan data yang sama seperti yang PurTV tampilkan.
 * Semua halaman anichin.com.co di-render SSR — cukup fetch HTTPS biasa.
 *
 * Riwayat: domain lama anichin.cafe mati (redirect loop). URL lama tetap
 * diterima dan dinormalisasi ke anichin.com.co (/seri/ -> /series/).
 */

import * as cheerio from 'cheerio';

// samehadaku.js di-import dinamis per fungsi: ia me-load got-scraping (external,
// browserslist require dinamis) yang merusak 'collect page data' Next bila
// di-load saat build. Dengan import dinamis, module only di-load saat runtime.

const HOST = 'https://anichin.com.co';
const MOE_HOST = 'https://anichin.moe';
const LEGACY_HOST = 'https://anichin.cafe';
const ANIME_HOST = 'v2.samehadaku.how';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36';
// Transport cadangan: anichin di balik Cloudflare "Managed Challenge" (turnstile)
// yang memblokir IP datacenter (mis. Vercel) -> 403. Frontend purtv.vercel.app sendiri
// melewati proxy ini; dipakai sebagai fallback agar prod tetap jalan.
const CF_PROXY = 'https://vercel-api-beta-red.vercel.app/api/fetch';

async function getHtmlWithProxy(url) {
  const res = await fetch(`${CF_PROXY}?get=${encodeURIComponent(url)}`, {
    headers: { 'user-agent': UA },
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`anichin.com.co gagal diakses (HTTP ${res.status})`);
  return res.text();
}

async function getHtml(url) {
  let html = null;
  try {
    const res = await fetch(url, {
      headers: { 'user-agent': UA, 'accept': 'text/html,application/xhtml+xml,*/*' },
      redirect: 'follow',
    });
    if (res.ok) html = await res.text();
    else if (res.status === 403) html = null;
    else throw new Error(`anichin.com.co gagal diakses (HTTP ${res.status})`);
  } catch {
    html = null;
  }
  const isChallenge = (h) => !h || /<title>Just a moment/.test(h) || /challenge-error-text/.test(h);
  if (isChallenge(html)) {
    // CF Managed Challenge — coba lewat proxy (transport PurTV).
    try {
      html = await getHtmlWithProxy(url);
    } catch {
      // biarkan fallback di bawah yang lempar error informatif
    }
  }
  if (!html) throw new Error('anichin.com.co gagal diakses (jaringan/CF)');
  if (isChallenge(html)) {
    throw new Error('anichin.com.co menghadang Cloudflare challenge (coba lagi nanti)');
  }
  // Perbaiki iframe #pembed yang tidak ditutup (situs mengirim
  // `<iframe ...></</div>` tanpa </iframe>). iframe adalah rawtext element —
  // tanpa penutup, htmlparser2 menelan sisa halaman sehingga selector
  // sesudahnya (.mirror, .naveps, .headlist) kosong: streamingLinks [],
  // series/thumbnail/nav null. Sisipkan penutup yang hilang.
  // Pola: `<iframe ...>` + `</` yang langsung diikuti `</div>` ->
  // `<iframe ...></iframe>` + `</div>`. Yang well-formed tidak tersentuh.
  html = html.replace(/(<iframe\b[^>]*>)\s*<\/\s*(?=\s*<\/div>)/gi, '$1</iframe>');
  return html;
}

const SCRAPER_WEB = 'https://vercel-api-beta-red.vercel.app/api/scraper-web';

function absUrl(path) {
  if (!path) return null;
  return String(path).startsWith('http') ? path : `${HOST}${path}`;
}

async function scrapeAnichin(url, output) {
  const res = await fetch(SCRAPER_WEB, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, output: JSON.stringify(output) }),
  });
  if (!res.ok) throw new Error(`scraper-web gagal (HTTP ${res.status})`);
  return res.json();
}

function mapScrapedCard(r) {
  if (!r) return null;
  let thumb = r.thumbnail || null;
  if (thumb && String(thumb).startsWith('data:image')) thumb = null;
  let url = r.url || null;
  if (url && !/^https?:\/\//i.test(url)) url = `${HOST}${url.startsWith('/') ? '' : '/'}${url}`;
  if (!r.title || !url) return null;
  return {
    source: 'anichin',
    title: r.title,
    thumbnail: thumb,
    url,
    type: r.type || null,
    status: r.status || null,
    episode: r.episode || null,
  };
}

/**
 * Normalisasi URL lama ke format baru agar link lama tetap jalan:
 * anichin.cafe -> anichin.com.co, /seri/<slug>/ -> /series/<slug>/.
 */
function normalizeUrl(url) {
  if (!url) return `${HOST}/`;
  let out = String(url).trim();
  if (out.startsWith(LEGACY_HOST)) out = HOST + out.slice(LEGACY_HOST.length);
  out = out.replace(`${HOST}/seri/`, `${HOST}/series/`);
  return out;
}

/**
 * Ambil URL gambar asli. Situs memakai lazy-load: `src` hanya placeholder
 * `data:image/svg+xml`, gambar asli ada di `data-src`.
 */
function imgSrc($img) {
  if (!$img || !$img.length) return null;
  const cands = [$img.attr('data-src'), $img.attr('data-litespeed-src'), $img.attr('src')];
  for (const c of cands) {
    if (c && !c.startsWith('data:image')) return c;
  }
  return null;
}

/** Kartu listing donghua (cari, filter genre, beranda). */
function parseCard($, $art) {
  const title =
    $art.find('.tt h2').first().text().trim()
    || $art.find('h2').first().text().trim()
    || $art.find('a').first().attr('title')
    || $art.find('a').first().text().trim()
    || null;
  let href = $art.find('a').first().attr('href') || null;
  return {
    title,
    thumbnail: imgSrc($art.find('img').first()),
    url: absUrl(href),
    type: $art.find('.typez').first().text().trim() || null,
    status: $art.find('.status').first().text().trim() || null,
    episode: $art.find('.epx').first().text().trim() || $art.find('.ep').first().text().trim() || null,
  };
}

/** Item ranking populer mingguan/bulanan/semua (.serieslist li). */
function parsePopular($, $li) {
  const $a = $li.find('h4 a').first();
  return {
    title: $a.text().trim() || null,
    url: absUrl($a.attr('href')),
    thumbnail: imgSrc($li.find('.imgseries img').first()),
    genres: $li
      .find('a[rel="tag"]')
      .map((_, a) => $(a).text().trim())
      .get()
      .filter(Boolean),
    rating: $li.find('.numscore').first().text().trim() || null,
  };
}

function hasNextPage($) {
  return $('.pagination a.next, .hpage a.r').length > 0;
}

/** purtv_pagenation — metadata navigasi yang konsisten di tiap respon list. */
function pagenation(currentPage, hasNext) {
  return { currentPage, hasNext };
}

/** Deteksi sumber dari URL: samehadaku (anime) vs anichin (donghua). */
function isAnimeUrl(url) {
  return /samehadaku\.how/i.test(url || '');
}

/** Slug anime dari URL samehadaku — dukungan /anime/<slug>/ maupun /<slug>/ (episode). */
function animeSlug(url) {
  return (url || '').replace(/\/+$/, '').split('/').pop();
}

function animeIsSeriesUrl(url) {
  return /samehadaku\.how\/anime\//i.test(url || '');
}

function emptyAnime() {
  return { results: [], hasNext: false };
}

/** anichin me-404-kan halaman yang tidak ada -> kembalikan hasil kosong (seperti PurTV). */
function emptyPaging(payload) {
  return { source: 'purtv.vercel.app', ...payload, hasNext: false, results: [] };
}

let _samehadaku;
async function samehadaku() {
  if (!_samehadaku) _samehadaku = import('./samehadaku.js');
  return _samehadaku;
}

/**
 * Resolve halaman mirror (/v/N/) menjadi iframe embed asli.
 * Halaman mirror berisi 1 iframe player (data-litespeed-src) + iframe iklan
 * yang dilewati. Gagal resolve -> null (pemanggil pakai URL mirror apa adanya).
 */
async function resolveMirror(pageUrl) {
  try {
    const html = await getHtml(pageUrl);
    const $ = cheerio.load(html);
    let found = null;
    $('iframe').each((_, el) => {
      const src = $(el).attr('data-litespeed-src') || $(el).attr('src') || '';
      if (!src || src === 'about:blank' || /^data:/i.test(src)) return;
      if (/fakewatches/i.test(src)) return; // iklan
      if (!found || /anichin\.stream/i.test(src)) found = src;
    });
    // Player anichin cek Referer -> resolve ke embed asli (Dailymotion) server-side.
    if (found) return await resolveAnichinPlayer(found);
    return found;
  } catch {
    return null;
  }
}

/**
 * Resolve URL player anichin (anichin-player.web.id) menjadi iframe embed asli.
 * Player cek Referer: hanya mengizinkan domain anichin.care / anichin.moe —
 * kalau di-embed langsung dari domain lain, dia balas 403 "Domain Tidak
 * Diizinkan" + redirect JS ke anichin.moe. Solusi: fetch server-side dengan
 * Referer anichin.care, lalu ekstrak iframe asli (biasanya Dailymotion)
 * yang bisa di-embed di domain mana pun. Direct gagal (IP Vercel diblokir
 * host player) -> coba lewat proxy. Gagal semua -> URL semula.
 */
async function resolveAnichinPlayer(url) {
  if (!url || !/anichin-player\.web\.id/i.test(url)) return url;
  const headers = {
    'user-agent': UA,
    'referer': 'https://anichin.care/',
    'accept': 'text/html,application/xhtml+xml,*/*',
  };
  const extract = (html) => {
    if (!html || /Domain Tidak Diizinkan|Just a moment/.test(html)) return null;
    const m = html.match(/<iframe[^>]+src=["']([^"']+)["']/i);
    if (m && m[1]) {
      let src = m[1].replace(/&amp;/g, '&');
      if (src.startsWith('//')) src = 'https:' + src;
      if (src && src !== 'about:blank') return src;
    }
    return null;
  };
  try {
    const res = await fetch(url, { headers, redirect: 'follow' });
    if (res.ok) {
      const got = extract(await res.text());
      if (got) return got;
    }
  } catch {}
  // Fallback: IP datacenter kadang diblokir host player -> lewat proxy.
  try {
    const res = await fetch(`${CF_PROXY}?get=${encodeURIComponent(url)}`, {
      headers,
      redirect: 'follow',
    });
    if (res.ok) {
      const got = extract(await res.text());
      if (got) return got;
    }
  } catch {}
  return url;
}

/**
 * Extract ID Dailymotion dari berbagai bentuk URL:
 * - https://geo.dailymotion.com/player.html?video=ACCESS_ID
 * - https://www.dailymotion.com/embed/video/PUBLIC_ID
 * - https://www.dailymotion.com/video/PUBLIC_ID
 * Kembalikan ID mentah (bisa accessId panjang maupun publicId pendek).
 */
function extractDailymotionId(url) {
  if (!url) return null;
  const s = String(url);
  let m = s.match(/[?&]video=([^&#]+)/i);
  if (m && m[1]) return decodeURIComponent(m[1]);
  m = s.match(/dailymotion\.com\/(?:embed\/video\/|video\/)([A-Za-z0-9]+)/i);
  if (m && m[1]) return m[1];
  return null;
}

/**
 * Info Dailymotion dari accessId privat (geo player ?video=ACCESS_ID)
 * maupun publicId. Metadata player memetakan accessId -> id publik +
 * judul + qualities.auto (URL HLS m3u8 asli via cdndirector).
 * Diekstrak sampai ke source aslinya supaya frontend bisa putar langsung
 * via HLS tanpa kena batas domain embed ("tidak dapat memutar video di
 * situs ini"). Gagal -> null.
 */
async function dailymotionInfo(accessId) {
  if (!accessId) return null;
  try {
    const res = await fetch(`https://www.dailymotion.com/player/metadata/video/${encodeURIComponent(accessId)}`, {
      headers: { 'user-agent': UA, 'accept': 'application/json,*/*' },
      redirect: 'follow',
    });
    if (!res.ok) return null;
    const meta = await res.json().catch(() => null);
    const publicId = meta?.id || null;
    if (!publicId) return null;
    // Kumpulkan semua stream dari qualities: { auto: [{type,url}], 380: [...], ... }
    const qualities = meta?.qualities || {};
    const streams = [];
    for (const [qname, arr] of Object.entries(qualities)) {
      if (Array.isArray(arr)) {
        for (const it of arr) {
          if (it?.url) streams.push({ quality: qname, type: it?.type || null, url: it.url });
        }
      }
    }
    // Source utama: HLS m3u8 (auto) — ini URL asli yg dipakai player.
    const hlsUrl =
      streams.find((s) => /mpegURL|m3u8/i.test(s.type || '') || /m3u8/i.test(s.url || ''))?.url
      || streams[0]?.url
      || meta?.stream_hls_url
      || null;
    return {
      accessId,
      publicId,
      title: meta?.title || null,
      duration: meta?.duration || null,
      isPrivate: meta?.private ?? null,
      watchUrl: `https://www.dailymotion.com/video/${publicId}`,
      embedUrl: `https://www.dailymotion.com/embed/video/${publicId}`,
      // Source asli hasil extract:
      streamUrl: hlsUrl,
      hlsUrl,
      streams,
    };
  } catch {
    return null;
  }
}

/**
 * Resolve URL Dailymotion apa pun sampai ke source aslinya.
 * Input: geo player / embed / watch URL. Output: info dailymotion
 * lengkap (termasuk streamUrl HLS) atau null.
 */
async function resolveDailymotion(url) {
  const id = extractDailymotionId(url);
  if (!id) return null;
  try {
    return await dailymotionInfo(id);
  } catch {
    return null;
  }
}

/**
 * Fallback server dari anichin.moe (situs asli). anichin.com.co sering hanya
 * menyediakan 1 server (Dailymotion) yang bisa mati/private; anichin.moe
 * menyediakan banyak server (Okru, Rumble, D-Tube, dll) dalam bentuk
 * <option value="BASE64_IFRAME">. Decode base64 -> iframe src -> streamingLinks.
 * Gagal ambil halaman/parse -> [] (pemanggil pakai data com.co apa adanya).
 */
async function moeMirrorLinks(url) {
  try {
    const moeUrl = String(url)
      .replace(LEGACY_HOST, MOE_HOST)
      .replace(/^https?:\/\/anichin\.com\.co/i, MOE_HOST)
      .replace(`${MOE_HOST}/seri/`, `${MOE_HOST}/series/`);
    const html = await getHtml(moeUrl);
    const $ = cheerio.load(html);
    const links = [];
    $('.mirror option').each((_, el) => {
      const $el = $(el);
      const b64 = ($el.attr('value') || '').trim();
      if (!b64) return;
      let iframeHtml = '';
      try {
        // Decode base64 manual (tanpa Buffer/atob) supaya lolos ESLint.
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
        const clean = b64.replace(/[^A-Za-z0-9+/=]/g, '');
        let out = '';
        for (let i = 0; i < clean.length; i += 4) {
          const c1 = chars.indexOf(clean[i]);
          const c2 = chars.indexOf(clean[i + 1]);
          const c3 = chars.indexOf(clean[i + 2]);
          const c4 = chars.indexOf(clean[i + 3]);
          const triple = (c1 << 18) | (c2 << 12) | ((c3 & 63) << 6) | (c4 & 63);
          out += String.fromCharCode((triple >> 16) & 255);
          if (c3 !== -1 && clean[i + 2] !== '=') out += String.fromCharCode((triple >> 8) & 255);
          if (c4 !== -1 && clean[i + 3] !== '=') out += String.fromCharCode(triple & 255);
        }
        iframeHtml = out;
      } catch {
        return;
      }
      const m = iframeHtml.match(/<iframe\b[^>]*\bsrc=["']([^"']+)["']/i);
      if (!m || !m[1]) return;
      let src = m[1].replace(/&amp;/g, '&');
      if (src.startsWith('//')) src = 'https:' + src;
      const label = $el.text().trim() || null;
      links.push({
        server: label,
        index: $el.attr('data-index') || null,
        url: src,
        mirror: src,
        source: 'anichin.moe',
      });
    });
    return links;
  } catch {
    return [];
  }
}

/**
 * Beranda — gabungan dua sumber (donghua anichin + anime samehadaku).
 * Seksi donghua: featured slider (= Hot Series Update), populer hari ini,
 * rilis terbaru, ongoing (daftar teks), dan rekomendasi populer
 * mingguan/bulanan/semua (tab). Seksi anime: episode terbaru + populer.
 */
export async function fetchPurtvHome() {
  const [homeHtml, animeMod] = await Promise.all([
    getHtml(`${HOST}/`).catch(() => null),
    samehadaku(),
  ]);
  const anime = await animeMod.fetchSamehadakuHome();
  const $ = homeHtml ? cheerio.load(homeHtml) : cheerio.load('<html><body></body></html>');

  const hotCards = $('.bixbox:has(.releases.hothome) .listupd article.bs')
    .map((_, el) => parseCard($, $(el)))
    .get();
  const featuredSlider = hotCards.map((c) => ({
    title: c.title,
    thumbnail: c.thumbnail,
    url: c.url,
    description: null,
  }));
  const popularToday = hotCards;
  const latestReleases = $('.listupd.normal article.bs')
    .map((_, el) => parseCard($, $(el)))
    .get();

  const ranges = [
    ['weekly', 'Weekly'],
    ['monthly', 'Monthly'],
    ['alltime', 'All'],
  ];
  const recommend = {
    genres: ranges.map(([id, name]) => ({ id, name })),
    items: ranges.map(([id]) => ({
      id,
      list: $(`.serieslist.pop.wpop-${id} li`)
        .map((_, el) => parsePopular($, $(el)))
        .get(),
    })),
  };

  // Situs baru tidak punya halaman /ongoing/ — daftar teks di beranda tanpa
  // thumbnail. Perkaya dengan poster dari kartu lain yang judulnya cocok,
  // supaya card ongoing tidak tampil kotak kosong/rusak.
  const normTitle = (s) =>
    (s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  const thumbPool = [...hotCards, ...latestReleases];
  for (const grp of recommend.items) for (const it of grp.list) thumbPool.push(it);
  const ongoing = $('.ongoingseries ul li')
    .map((_, el) => {
      const $el = $(el);
      const title = $el.find('.l').first().text().trim();
      const nt = normTitle(title);
      const hit = nt
        ? thumbPool.find((c) => c?.thumbnail && normTitle(c.title).includes(nt))
        : null;
      return {
        title,
        url: absUrl($el.find('a').first().attr('href')),
        episode: $el.find('.r').first().text().trim(),
        thumbnail: hit?.thumbnail || null,
        source: 'anichin',
      };
    })
    .get();

  return {
    source: 'purtv.vercel.app',
    featuredSlider,
    popularToday,
    latestReleases,
    ongoing,
    recommendations: recommend,
    anime: {
      latestAnime: (anime?.homepage || []).map((a) => ({
        title: a.title,
        thumbnail: a.image,
        url: a.url,
        episode: a.episode ? `Ep ${a.episode}` : null,
      })),
      popularAnime: anime?.popularAnime || [],
    },
    purtv_pagenation: pagenation(1, false),
  };
}

/**
 * Detail episode — gabungan dua sumber. URL anichin → donghua; URL samehadaku
 * → anime. Untuk donghua: judul, seri induk, player default, daftar server
 * video (halaman mirror /v/N/ di-resolve ke iframe), navigasi episode.
 * Situs baru tidak menyediakan link download -> downloadLinks kosong.
 */
export async function fetchPurtvDetail(url) {
  if (isAnimeUrl(url)) {
    if (animeIsSeriesUrl(url)) {
      throw new Error('URL seri anime harus dipanggil lewat /api/purtv/series');
    }
    const slug = animeSlug(url);
    const { fetchSamehadakuEpisode } = await samehadaku();
    const res = await fetchSamehadakuEpisode(slug);
    if (res.error) throw new Error(res.error);
    return {
      source: 'purtv.vercel.app',
      title: res.title,
      series: res.anime?.title || null,
      seriesUrl: res.anime?.url || null,
      synopsis: res.anime?.synopsis || null,
      thumbnail: res.thumbnail || res.anime?.poster || null,
      defaultIframe: null,
      episodeSlug: slug,
      streamingLinks: (res.servers || []).map((s) => ({
        server: s.name,
        index: s.nume,
        url: null,
        post: s.post,
        nume: s.nume,
        type: s.type,
      })),
      downloadLinks: (res.downloads || []).map((d) => ({
        quality: (d.qualities || []).map((q) => q.quality).filter(Boolean).join(' '),
        links: (d.qualities || []).flatMap((q) => q.links || []),
      })),
      navigation: {
        prev: res.navigation?.prev?.url || null,
        next: res.navigation?.next?.url || null,
        allEpisodes: res.anime?.url || null,
      },
      episode: res.episode || null,
      purtv_pagenation: pagenation(1, false),
    };
  }
  const html = await getHtml(normalizeUrl(url));
  const $ = cheerio.load(html);

  // Seri induk dari headlist (fallback: tombol All Episodes).
  const $seriesA = $('.headlist .det h2 a').first().length
    ? $('.headlist .det h2 a').first()
    : $('.naveps .nvsc a').first();
  const series = $seriesA.text().trim() || null;
  const seriesUrl = absUrl($seriesA.attr('href'));

  // Daftar server: option value = halaman mirror /v/N/ -> resolve ke iframe.
  const mirrors = $('.mirror option')
    .map((_, el) => {
      const $el = $(el);
      const page = ($el.attr('value') || '').trim();
      if (!page) return null;
      return {
        server: $el.text().trim() || null,
        index: $el.attr('data-index') || null,
        page,
      };
    })
    .get()
    .filter(Boolean);
  const streamingLinks = await Promise.all(
    mirrors.map(async (m) => {
      let iframe = await resolveMirror(m.page);
      // Setiap ketemu link Dailymotion (geo/embed/watch) -> extract sampai
      // ke source HLS aslinya supaya bisa diputar cross-domain.
      let dm = null;
      try {
        if (/dailymotion\.com/i.test(String(iframe || ''))) {
          dm = await resolveDailymotion(iframe);
          // Default = embed publik (cross-domain OK). HLS sbg opsi tambahan.
          if (dm?.embedUrl) iframe = dm.embedUrl;
        }
      } catch {}
      const out = { server: m.server, index: m.index, url: iframe || m.page, mirror: m.page };
      if (dm) {
        out.dailymotion = dm;
        if (dm.streamUrl) out.streamUrl = dm.streamUrl;
        if (dm.hlsUrl) out.hlsUrl = dm.hlsUrl;
      }
      return out;
    })
  );

  // Fallback: anichin.com.co hanya menyediakan 1 server (Dailymotion) yang bisa
  // mati/private. anichin.moe (situs asli) punya banyak server (Okru, Rumble,
  // D-Tube, dll) untuk episode yang sama — tambahkan sebagai opsi cadangan.
  const moeLinks = await moeMirrorLinks(url);
  const existing = new Set(
    streamingLinks
      .map((l) => l.url)
      .filter(Boolean)
      .map((u) => u.replace(/\/+$/, ''))
  );
  for (const mLink of moeLinks) {
    if (!mLink.url) continue;
    const key = mLink.url.replace(/\/+$/, '');
    if (existing.has(key)) continue;
    streamingLinks.push(mLink);
  }

  const $frame = $('#pembed iframe').first();
  const frameSrc = $frame.attr('data-litespeed-src') || $frame.attr('src') || null;
  // Player anichin cek Referer — resolve server-side ke embed asli (Dailymotion)
  // supaya tidak 403 "Domain Tidak Diizinkan" saat di-embed dari domain lain.
  let defaultIframe = frameSrc && frameSrc !== 'about:blank'
    ? await resolveAnichinPlayer(frameSrc)
    : null;
  // Fallback Dailymotion: tiap ketemu link Dailymotion (geo privat/embed/watch)
  // -> extract sampai ke source HLS asli (qualities.auto via cdndirector).
  // Player geo menolak embed cross-domain ("tidak dapat memutar video di
  // situs ini"), jadi default pakai embed publik. URL HLS asli ikut
  // dikembalikan (dailymotion.streamUrl/hlsUrl + per-mirror streamUrl) sbg
  // opsi frontend (hls.js) — catatan: token HLS terikat IP peminta metadata,
  // jadi frontend harus siap fallback ke embed bila HLS 403 (E005).
  // Info dailymotion tetap dikembalikan utk fallback.
  let dailymotion = null;
  try {
    if (/dailymotion\.com/i.test(String(defaultIframe || ''))) {
      dailymotion = await resolveDailymotion(defaultIframe);
    }
  } catch {}
  // Default = embed publik (bisa diputar cross-domain di browser mana pun).
  if (dailymotion?.embedUrl) defaultIframe = dailymotion.embedUrl;
  // Dailymotion private (DM010) -> ganti default ke server alternatif yang
  // hidup dari anichin.moe (Okru/Rumble/D-Tube) supaya player tetap jalan.
  if (dailymotion?.isPrivate) {
    const alt = moeLinks.find(
      (l) => l.url && !/dailymotion\.com/i.test(l.url) && !/anichin-player\.web\.id/i.test(l.url)
    );
    if (alt?.url) defaultIframe = alt.url;
  }

  const navigation = {
    prev: absUrl($('.naveps .nvs a[rel="prev"]').first().attr('href')),
    next: absUrl($('.naveps .nvs a[rel="next"]').first().attr('href')),
    allEpisodes: absUrl($('.naveps .nvsc a').first().attr('href')),
  };

  return {
    source: 'purtv.vercel.app',
    title: $('.entry-title').first().text().trim(),
    // Halaman episode memakai lazy-load — baca data-src via .headlist.
    thumbnail:
      imgSrc($('.headlist .thumb img').first())
      || $('meta[property="og:image"]').first().attr('content')
      || $('.entry-content img').first().attr('src')
      || null,
    series,
    seriesUrl,
    synopsis:
      $('meta[name="description"]').first().attr('content')
      || $('meta[property="og:description"]').first().attr('content')
      || null,
    defaultIframe,
    dailymotion,
    streamingLinks,
    downloadLinks: [],
    navigation,
    purtv_pagenation: pagenation(1, false),
  };
}

/**
 * Halaman seri — gabungan dua sumber. URL anichin (/series/<slug>/) → donghua;
 * URL samehadaku (/anime/<slug>/) → anime. Info lengkap + daftar episode.
 * URL lama (/seri/) dinormalisasi otomatis.
 */
export async function fetchPurtvSeries(url) {
  if (isAnimeUrl(url)) {
    const slug = animeSlug(url);
    const { fetchSamehadakuDetail } = await samehadaku();
    const res = await fetchSamehadakuDetail(slug);
    if (res.error) throw new Error(res.error);
    return {
      source: 'purtv.vercel.app',
      title: res.title,
      genres: (res.genres || []).map((g) => g.name),
      synopsis: res.synopsis,
      info: res.info,
      episodes: (res.episodes || []).map((e) => ({
        episode: e.number,
        title: e.title,
        url: e.url,
      })),
      poster: res.poster,
      rating: res.rating,
      purtv_pagenation: pagenation(1, false),
    };
  }
  const html = await getHtml(normalizeUrl(url));
  const $ = cheerio.load(html);

  const info = {};
  $('.info-content .spe span, .infox .spe span').each((_, el) => {
    const $b = $(el).find('b').first();
    const label = $b.text().replace(':', '').trim();
    if (label) info[label] = $(el).text().replace($b.text(), '').trim();
  });

  let genres = $('.genxed a')
    .map((_, a) => $(a).text().trim())
    .get()
    .filter(Boolean);
  if (genres.length === 0) {
    genres = $('.info-content a[href*="/genres/"]')
      .map((_, a) => $(a).text().trim())
      .get()
      .filter(Boolean);
  }

  return {
    source: 'purtv.vercel.app',
    title: $('.entry-title').first().text().trim(),
    poster: imgSrc($('.thumb img').first())
      || $('meta[property="og:image"]').first().attr('content')
      || null,
    rating: $('.numscore').first().text().trim()
      || $('.thumbook .rating strong').first().text().trim().replace(/^Rating\s*/i, '')
      || null,
    genres,
    synopsis: $('.mindesc').first().text().trim()
      || $('.entry-content p').first().text().trim()
      || null,
    info,
    episodes: $('.eplister ul li a')
      .map((_, a) => ({
        episode: $(a).find('.epl-num').first().text().trim() || null,
        title: $(a).find('.epl-title').first().text().trim() || null,
        url: absUrl($(a).attr('href')),
      }))
      .get(),
    purtv_pagenation: pagenation(1, false),
  };
}

/**
 * Pencarian — gabungan dua sumber (donghua anichin + anime samehadaku).
 * Hasil donghua bisa berupa episode maupun seri (/series/...).
 * Setiap item hasil diberi penanda `source` ('anichin' / 'samehadaku').
 */
export async function fetchPurtvSearch(q, page = 1) {
  const urlD =
    page > 1
      ? `${HOST}/page/${page}/?s=${encodeURIComponent(q)}`
      : `${HOST}/?s=${encodeURIComponent(q)}`;

  const [donghua, anime] = await Promise.all([
    getHtml(urlD)
      .then((html) => {
        const $ = cheerio.load(html);
        return {
          results: $('.listupd article.bs').map((_, el) => parseCard($, $(el))).get(),
          hasNext: hasNextPage($),
        };
      })
      .catch((error) =>
        /HTTP 404/.test(error.message) ? emptyPaging({ query: q, page }) : Promise.reject(error)
      ),
    samehadaku().then((m) => m.fetchSamehadakuSearchPage(q, page).catch(() => emptyAnime())),
  ]);

  const donghuaRes =
    donghua && Array.isArray(donghua.results) ? donghua : emptyPaging({ query: q, page });
  const animeRes = anime && !anime.error ? anime : emptyAnime();

  const results = [
    ...(donghuaRes.results || []).map((r) => ({ source: 'anichin', ...r })),
    ...animeRes.results.map((r) => ({ source: 'samehadaku', ...r })),
  ];

  return {
    source: 'purtv.vercel.app',
    query: q,
    page,
    hasNext: Boolean(donghuaRes.hasNext || animeRes.hasNext),
    results,
    purtv_pagenation: pagenation(page, Boolean(donghuaRes.hasNext || animeRes.hasNext)),
  };
}

/**
 * Jadwal rilis — gabungan dua sumber.
 * - Anime (Senin–Minggu): dari REST API resmi samehadaku
 *   (wp-json/custom/v1/all-schedule per hari). Bentuk: schedule: [{ day, dayEn, list }].
 * - Donghua: anichin.com.co TIDAK menyediakan halaman jadwal, jadi diambil
 *   dari beranda anichin (rilis terbaru + hot update) sebagai
 *   donghuaSchedule: [{ day, dayEn, list }]. Ini yang sebelumnya kosong
 *   ("respon dari anichin tidak ada") — sekarang selalu ada fallback.
 * Keduanya di-fetch paralel; satu sumber gagal -> sumber lain tetap jalan.
 */
export async function fetchPurtvSchedule() {
  const { fetchSamehadakuSchedule } = await samehadaku();
  const [animeRes, donghuaList] = await Promise.all([
    fetchSamehadakuSchedule().catch(() => ({ schedule: [] })),
    fetchAnichinDonghua().catch(() => []),
  ]);
  const schedule = Array.isArray(animeRes.schedule) ? animeRes.schedule : [];
  const donghuaSchedule =
    donghuaList.length > 0
      ? [{ day: 'Update Donghua', dayEn: 'donghua', list: donghuaList }]
      : [];
  const noteParts = [];
  if (schedule.length === 0 || schedule.every((d) => (d.list || []).length === 0))
    noteParts.push('jadwal anime samehadaku kosong/gagal');
  if (donghuaSchedule.length === 0) noteParts.push('jadwal donghua anichin kosong/gagal');
  return {
    source: 'purtv.vercel.app',
    schedule,
    donghuaSchedule,
    donghua: donghuaList,
    ...(noteParts.length ? { note: `Jadwal sebagian kosong: ${noteParts.join('; ')}` } : {}),
    purtv_pagenation: pagenation(1, false),
  };
}

/**
 * Donghua terbaru dari beranda anichin — dipakai sebagai isi tab Jadwal
 * untuk donghua (anichin tidak punya halaman jadwal resmi).
 * Urutan: fetch langsung -> scraper-web proxy (lolos CF) -> [].
 * Selector dibuat longgar (tema ganti class) + fallback ongoing.
 */
async function fetchAnichinDonghua() {
  const seen = new Set();
  const out = [];
  const push = (c) => {
    if (!c || !c.title || !c.url) return;
    const key = String(c.url).replace(/\/+$/, '');
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ source: 'anichin', ...c });
  };
  const parseHtml = (html) => {
    const $ = cheerio.load(html);
    // Selector utama + cadangan bila tema berubah.
    const sels = [
      '.bixbox:has(.releases.hothome) .listupd article.bs',
      '.listupd.normal article.bs',
      '.listupd article.bs',
      'article.bs',
      '.releases .listupd article',
      '.ongoingseries ul li a',
    ];
    for (const sel of sels) {
      $(sel).each((_, el) => {
        const $el = $(el);
        if ($el.is('a')) {
          const title = $el.text().trim() || $el.attr('title') || null;
          const url = absUrl($el.attr('href'));
          if (title && url) push({ title, url, episode: null, thumbnail: imgSrc($el.find('img').first()), type: 'Ongoing' });
        } else {
          push(parseCard($, $el));
        }
      });
      if (out.length >= 10) break;
    }
    if (out.length < 10) {
      $('.ongoingseries ul li').each((_, el) => {
        const $el = $(el);
        const title = $el.find('.l').first().text().trim() || $el.find('a').first().text().trim();
        const url = absUrl($el.find('a').first().attr('href'));
        if (title && url) push({ title, url, episode: $el.find('.r').first().text().trim() || null, thumbnail: null, type: 'Ongoing' });
      });
    }
  };
  // 1) Fetch langsung (+ CF_PROXY fallback di dalam getHtml).
  try {
    const html = await getHtml(`${HOST}/`);
    parseHtml(html);
    if (out.length > 0) return out.slice(0, 40);
  } catch {}
  // 2) Fallback scraper-web proxy (pola samehadaku — terbukti lolos CF).
  try {
    const raw = await scrapeAnichin(`${HOST}/`, {
      hot: "$('.bixbox:has(.releases.hothome) .listupd article.bs').map((i, el) => ({ title: $(el).find('.tt h2').text().trim() || $(el).find('h2').text().trim(), thumbnail: $(el).find('img').attr('data-src') || $(el).find('img').attr('src'), url: $(el).find('a').attr('href'), type: $(el).find('.typez').text().trim(), status: $(el).find('.status').text().trim(), episode: $(el).find('.epx').text().trim() })).get()",
      latest: "$('.listupd.normal article.bs').map((i, el) => ({ title: $(el).find('.tt h2').text().trim() || $(el).find('h2').text().trim(), thumbnail: $(el).find('img').attr('data-src') || $(el).find('img').attr('src'), url: $(el).find('a').attr('href'), type: $(el).find('.typez').text().trim(), status: $(el).find('.status').text().trim(), episode: $(el).find('.epx').text().trim() })).get()",
      any: "$('article.bs').map((i, el) => ({ title: $(el).find('.tt h2').text().trim() || $(el).find('h2').text().trim(), thumbnail: $(el).find('img').attr('data-src') || $(el).find('img').attr('src'), url: $(el).find('a').attr('href'), type: $(el).find('.typez').text().trim(), status: $(el).find('.status').text().trim(), episode: $(el).find('.epx').text().trim() })).get()",
    });
    for (const key of ['hot', 'latest', 'any']) {
      for (const r of raw?.[key] || []) push(mapScrapedCard(r));
      if (out.length >= 10) break;
    }
  } catch {}
  return out.slice(0, 40);
}

/** Daftar genre (dari /series/) — slug yang sama dipakai utk navigasi dua sumber (pola PurTV). */
export async function fetchPurtvGenres() {
  const html = await getHtml(`${HOST}/series/`);
  const $ = cheerio.load(html);
  return {
    source: 'purtv.vercel.app',
    genres: $('.filter.dropdown')
      .first()
      .find('.dropdown-menu li')
      .map((_, el) => {
        const $el = $(el);
        return { name: $el.find('label').first().text().trim(), slug: $el.find('input').first().val() };
      })
      .get(),
    purtv_pagenation: pagenation(1, false),
  };
}

/**
 * Listing per genre — gabungan dua sumber (donghua anichin + anime samehadaku).
 * Pola sama dengan PurTV: anichin `/series/?genre[]=<slug>&page=N`, samehadaku
 * `/genre/<slug>/?order=latest`. Setiap item diberi penanda `source`.
 */
export async function fetchPurtvList({ genre = '', page = 1 } = {}) {
  const params = [`page=${page}`];
  if (genre) params.unshift(`genre%5B%5D=${encodeURIComponent(genre)}`);
  const urlD = `${HOST}/series/?${params.join('&')}`;

  const [donghua, anime] = await Promise.all([
    getHtml(urlD)
      .then((html) => {
        const $ = cheerio.load(html);
        return {
          results: $('.listupd article.bs').map((_, el) => parseCard($, $(el))).get(),
          hasNext: hasNextPage($),
        };
      })
      .catch((error) =>
        /HTTP 404/.test(error.message) ? emptyPaging({ genre: genre || 'semua', page }) : Promise.reject(error)
      ),
    genre
      ? samehadaku().then((m) => m.fetchSamehadakuGenrePage(genre, page).catch(() => emptyAnime()))
      : samehadaku().then((m) => m.fetchSamehadakuAnimeList(page).catch(() => emptyAnime())),
  ]);

  const donghuaRes =
    donghua && Array.isArray(donghua.results) ? donghua : emptyPaging({ genre: genre || 'semua', page });
  const animeRes = anime && !anime.error ? anime : emptyAnime();

  const results = [
    ...(donghuaRes.results || []).map((r) => ({ source: 'anichin', ...r })),
    ...animeRes.results.map((r) => ({ source: 'samehadaku', ...r })),
  ];

  return {
    source: 'purtv.vercel.app',
    genre: genre || 'semua',
    page,
    hasNext: Boolean(donghuaRes.hasNext || animeRes.hasNext),
    results,
    purtv_pagenation: pagenation(page, Boolean(donghuaRes.hasNext || animeRes.hasNext)),
  };
}

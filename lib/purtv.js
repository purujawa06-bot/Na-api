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
const LEGACY_HOST = 'https://anichin.cafe';
const ANIME_HOST = 'v2.samehadaku.how';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36';
// Transport cadangan: anichin di balik Cloudflare "Managed Challenge" (turnstile)
// yang memblokir IP datacenter (mis. Vercel) -> 403. Frontend purtv.vercel.app sendiri
// melewati proxy ini; dipakai sebagai fallback agar prod tetap jalan.
const CF_PROXY = 'https://vercel-api-beta-red.vercel.app/api/fetch';

async function getHtml(url) {
  let res = await fetch(url, {
    headers: { 'user-agent': UA, 'accept': 'text/html,application/xhtml+xml,*/*' },
    redirect: 'follow',
  });
  if (res.status === 403) {
    // CF Managed Challenge — coba lewat proxy (transport PurTV).
    res = await fetch(`${CF_PROXY}?get=${encodeURIComponent(url)}`, {
      headers: { 'user-agent': UA },
      redirect: 'follow',
    });
  }
  if (!res.ok) throw new Error(`anichin.com.co gagal diakses (HTTP ${res.status})`);
  const html = await res.text();
  if (/<title>Just a moment/.test(html) || /challenge-error-text/.test(html)) {
    throw new Error('anichin.com.co menghadang Cloudflare challenge (coba lagi nanti)');
  }
  return html;
}

function absUrl(path) {
  if (!path) return null;
  return path.startsWith('http') ? path : `${HOST}${path}`;
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
  return {
    title: $art.find('.tt h2').first().text().trim() || null,
    thumbnail: imgSrc($art.find('img').first()),
    url: absUrl($art.find('a').first().attr('href')),
    type: $art.find('.typez').first().text().trim() || null,
    status: $art.find('.status').first().text().trim() || null,
    episode: $art.find('.epx').first().text().trim() || null,
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
 * Diizinkan" + redirect ke anichin.moe. Solusi: fetch server-side dengan
 * Referer anichin.care, lalu ekstrak iframe asli (biasanya Dailymotion)
 * yang bisa di-embed di domain mana pun.
 * Gagal resolve -> kembalikan URL semula (pemanggil pakai apa adanya).
 */
async function resolveAnichinPlayer(url) {
  if (!url || !/anichin-player\.web\.id/i.test(url)) return url;
  try {
    const res = await fetch(url, {
      headers: {
        'user-agent': UA,
        'referer': 'https://anichin.care/',
        'accept': 'text/html,application/xhtml+xml,*/*',
      },
      redirect: 'follow',
    });
    if (!res.ok) return url;
    const html = await res.text();
    if (/Domain Tidak Diizinkan|Just a moment/.test(html)) return url;
    const m = html.match(/<iframe[^>]+src=["']([^"']+)["']/i);
    if (m && m[1]) {
      let src = m[1].replace(/&amp;/g, '&');
      if (src.startsWith('//')) src = 'https:' + src;
      if (src && src !== 'about:blank') return src;
    }
    return url;
  } catch {
    return url;
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
      const iframe = await resolveMirror(m.page);
      return { server: m.server, index: m.index, url: iframe || m.page, mirror: m.page };
    })
  );

  const $frame = $('#pembed iframe').first();
  const frameSrc = $frame.attr('data-litespeed-src') || $frame.attr('src') || null;
  // Player anichin cek Referer — resolve server-side ke embed asli (Dailymotion)
  // supaya tidak 403 "Domain Tidak Diizinkan" saat di-embed dari domain lain.
  const defaultIframe = frameSrc && frameSrc !== 'about:blank'
    ? await resolveAnichinPlayer(frameSrc)
    : null;

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
 * Jadwal rilis — situs baru (anichin.com.co) tidak menyediakan halaman jadwal,
 * jadi endpoint mengembalikan daftar kosong + note (HTTP 200, bukan error)
 * agar frontend tetap jalan.
 */
export async function fetchPurtvSchedule() {
  return {
    source: 'purtv.vercel.app',
    schedule: [],
    note: 'Jadwal rilis tidak tersedia di sumber anichin.com.co',
    purtv_pagenation: pagenation(1, false),
  };
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

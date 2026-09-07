/**
 * Client anichin.cafe — sumber data frontend purtv.vercel.app (donghua sub Indo).
 * Frontend purtv.vercel.app (SPA React) men-scrape anichin.cafe lewat proxy pihak
 * ketiga (vercel-api-beta-red) + samehadaku. Modul ini mengganti proxy tersebut:
 * scraping anichin.cafe langsung dengan cheerio (sudah jadi dependency), sehingga
 * endpoint di sini mengembalikan data yang sama seperti yang PurTV tampilkan.
 * Semua halaman anichin.cafe di-render SSR — cukup fetch HTTPS biasa.
 */

import * as cheerio from 'cheerio';

// samehadaku.js di-import dinamis per fungsi: ia me-load got-scraping (external,
// browserslist require dinamis) yang merusak 'collect page data' Next bila
// di-load saat build. Dengan import dinamis, module only di-load saat runtime.

const HOST = 'https://anichin.cafe';
const ANIME_HOST = 'v2.samehadaku.how';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36';
// Transport cadangan: anichin.cafe di balik Cloudflare "Managed Challenge" (turnstile)
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
  if (!res.ok) throw new Error(`anichin.cafe gagal diakses (HTTP ${res.status})`);
  const html = await res.text();
  if (/<title>Just a moment/.test(html) || /challenge-error-text/.test(html)) {
    throw new Error('anichin.cafe menghadang Cloudflare challenge (coba lagi nanti)');
  }
  return html;
}

function absUrl(path) {
  if (!path) return null;
  return path.startsWith('http') ? path : `${HOST}${path}`;
}

/** Decode nilai <option> base64 (iframe hasil enkripsi server) menjadi src iframe. */
function decodeMirrorOption(value) {
  if (!value) return null;
  try {
    const html = Buffer.from(value, 'base64').toString('utf8');
    const m = html.match(/src=["']([^"']+)["']/i);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

/** Kartu listing donghua (cari, filter genre, beranda). */
function parseCard($art) {
  return {
    title: $art.find('.tt h2').first().text().trim() || null,
    thumbnail: $art.find('img').first().attr('src') || null,
    url: absUrl($art.find('a').first().attr('href')),
    type: $art.find('.typez').first().text().trim() || null,
    status: $art.find('.status').first().text().trim() || null,
    episode: $art.find('.epx').first().text().trim() || null,
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
 * Beranda — gabungan dua sumber (donghua anichin + anime samehadaku).
 * Seksi donghua: featured slider, populer hari ini, rilis terbaru, ongoing,
 * dan rekomendasi per genre (tab). Seksi anime: episode terbaru + populer.
 */
export async function fetchPurtvHome() {
  const [donghua, animeMod] = await Promise.all([
    getHtml(`${HOST}/`).catch(() => null),
    samehadaku(),
  ]);
  const anime = await animeMod.fetchSamehadakuHome();
  const $ = donghua ? cheerio.load(donghua) : cheerio.load('<html><body></body></html>');

  const featuredSlider = $('#slidertwo .swiper-slide.item')
    .map((_, el) => {
      const $el = $(el);
      const style = $el.find('.backdrop').first().attr('style') || '';
      const m = style.match(/background-image:\s*url\((['"]?)(.*?)\1\)/i);
      return {
        title: $el.find('h2 a').first().text().trim(),
        thumbnail: m ? m[2] : $el.find('img').first().attr('src'),
        url: absUrl($el.find('h2 a').first().attr('href')),
        description: $el.find('.info p').first().text().trim() || null,
      };
    })
    .get();

  const popularToday = $('.bixbox:has(.releases.hothome) .listupd article.bs')
    .map((_, el) => parseCard($(el)))
    .get();
  const latestReleases = $('.listupd.normal article.bs')
    .map((_, el) => parseCard($(el)))
    .get();

  const ongoing = $('.ongoingseries ul li')
    .map((_, el) => {
      const $el = $(el);
      return {
        title: $el.find('.l').first().text().trim(),
        url: absUrl($el.find('a').first().attr('href')),
        episode: $el.find('.r').first().text().trim(),
      };
    })
    .get();

  const recommend = {
    genres: $('.series-gen .nav-tabs li a')
      .map((i, el) => ({ id: $(el).attr('href')?.replace('#', ''), name: $(el).text().trim() }))
      .get(),
    items: $('.series-gen .tab-pane')
      .map((_, el) => ({
        id: $(el).attr('id'),
        list: $(el).find('article.bs').map((_, art) => parseCard($(art))).get(),
      }))
      .get(),
  };

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
 * video (base64 di-decode), link download (jika ada), dan navigasi episode.
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
      defaultIframe: null,
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
  const html = await getHtml(absUrl(url) || `${HOST}/`);
  const $ = cheerio.load(html);

  const seriesEl =
    $('#breadcrumbs ol li:nth-child(3) a').first() ||
    $('.ts-breadcrumb li:nth-child(3) a').first();
  const series = seriesEl.find('span').first().text().trim() || seriesEl.text().trim() || null;
  const seriesUrl = absUrl(seriesEl.attr('href'));

  const streamingLinks = $('.mirror option')
    .map((i, el) => {
      const $el = $(el);
      const src = decodeMirrorOption($el.attr('value'));
      return src ? { server: $el.text().trim(), index: $el.attr('data-index'), url: src } : null;
    })
    .get();

  const downloadLinks = $('.download-eps')
    .map((_, el) => {
      const cat = $(el).find('p b').first().text().trim();
      return $(el)
        .find('ul li')
        .map((j, li) => ({
          quality: cat ? `${cat} ${$(li).find('strong').first().text().trim()}`.trim() : null,
          links: $(li)
            .find('span a')
            .map((k, a) => ({ host: $(a).text().trim(), link: $(a).attr('href') }))
            .get(),
        }))
        .get();
    })
    .get()
    .flat()
    .filter((d) => d.quality || d.links.length);

  const navigation = {
    prev: absUrl($('.naveps .nvs a[rel="prev"]').first().attr('href')),
    next: absUrl($('.naveps .nvs a[rel="next"]').first().attr('href')),
    allEpisodes: absUrl($('.naveps .nvsc a').first().attr('href')),
  };

  return {
    source: 'purtv.vercel.app',
    title: $('.entry-title').first().text().trim(),
    series,
    seriesUrl,
    synopsis: $('.entry-content p').first().text().trim() || null,
    defaultIframe: $('#pembed iframe').first().attr('src') || null,
    streamingLinks,
    downloadLinks,
    navigation,
    purtv_pagenation: pagenation(1, false),
  };
}

/**
 * Halaman seri — gabungan dua sumber. URL anichin (/seri/<slug>/) → donghua;
 * URL samehadaku (/anime/<slug>/) → anime. Info lengkap + daftar episode.
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
  const html = await getHtml(absUrl(url) || `${HOST}/`);
  const $ = cheerio.load(html);

  const info = {};
  $('.infox .spe span').each((_, el) => {
    const $b = $(el).find('b').first();
    const label = $b.text().replace(':', '').trim();
    if (label) info[label] = $(el).text().replace($b.text(), '').trim();
  });

  return {
    source: 'purtv.vercel.app',
    title: $('.entry-title').first().text().trim(),
    genres: $('.infox .genxed a')
      .map((_, a) => $(a).text().trim())
      .get(),
    synopsis: $('.entry-content p').first().text().trim() || null,
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
          results: $('.listupd article.bs').map((_, el) => parseCard($(el))).get(),
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

/** Jadwal rilis donghua per hari (dari /schedule/). */
export async function fetchPurtvSchedule() {
  const html = await getHtml(`${HOST}/schedule/`);
  const $ = cheerio.load(html);
  return {
    source: 'purtv.vercel.app',
    schedule: $('.bixbox.schedulepage')
      .map((_, el) => {
        const $el = $(el);
        return {
          day: $el.find('.releases h3 span').first().text().trim(),
          totalCount: $el.find('.listupd .bs').length,
          list: $el
            .find('.listupd .bs')
            .map((j, item) => {
              const $it = $(item);
              return {
                title: $it.find('.tt').first().text().replace(/\s+/g, ' ').trim(),
                url: absUrl($it.find('.bsx a').first().attr('href')),
                thumbnail: $it.find('.limit img').first().attr('src'),
                releaseTime: $it.find('.bt .epx').first().text().trim() || null,
                nextEpisode: $it.find('.bt .sb').first().text().trim() || null,
              };
            })
            .get(),
        };
      })
      .get(),
    purtv_pagenation: pagenation(1, false),
  };
}

/** Daftar genre (dari /seri/) — slug yang sama dipakai utk navigasi dua sumber (pola PurTV). */
export async function fetchPurtvGenres() {
  const html = await getHtml(`${HOST}/seri/`);
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
 * Pola sama dengan PurTV: anichin `?genre[]=<slug>&page=N`, samehadaku
 * `/genre/<slug>/?order=latest`. Setiap item diberi penanda `source`.
 */
export async function fetchPurtvList({ genre = '', page = 1 } = {}) {
  const params = [`page=${page}`];
  if (genre) params.unshift(`genre%5B%5D=${encodeURIComponent(genre)}`);
  const urlD = `${HOST}/seri/?${params.join('&')}`;

  const [donghua, anime] = await Promise.all([
    getHtml(urlD)
      .then((html) => {
        const $ = cheerio.load(html);
        return {
          results: $('.listupd article.bs').map((_, el) => parseCard($(el))).get(),
          hasNext: hasNextPage($),
        };
      })
      .catch((error) =>
        /HTTP 404/.test(error.message) ? emptyPaging({ genre: genre || 'semua', page }) : Promise.reject(error)
      ),
    genre
      ? samehadaku().then((m) => m.fetchSamehadakuGenrePage(genre, page).catch(() => emptyAnime()))
      : Promise.resolve(emptyAnime()),
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
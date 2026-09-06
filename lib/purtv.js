/**
 * Client anichin.cafe — sumber data frontend purtv.vercel.app (donghua sub Indo).
 * Frontend purtv.vercel.app (SPA React) men-scrape anichin.cafe lewat proxy pihak
 * ketiga (vercel-api-beta-red) + samehadaku. Modul ini mengganti proxy tersebut:
 * scraping anichin.cafe langsung dengan cheerio (sudah jadi dependency), sehingga
 * endpoint di sini mengembalikan data yang sama seperti yang PurTV tampilkan.
 * Semua halaman anichin.cafe di-render SSR — cukup fetch HTTPS biasa.
 */

import * as cheerio from 'cheerio';

const HOST = 'https://anichin.cafe';
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

function hasNextPage($, html) {
  return (
    $('.pagination a.next, .hpage a.r, .pagination a.next.page-numbers').length > 0 ||
    /page-number/.test(html)
  );
}

/**
 * Beranda — featured slider, populer hari ini, rilis terbaru, ongoing, dan
 * rekomendasi per genre (tab). Sama seperti seksi yang ditampilkan PurTV.
 */
export async function fetchPurtvHome() {
  const html = await getHtml(`${HOST}/`);
  const $ = cheerio.load(html);

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
  };
}

/**
 * Detail episode — judul, seri induk, player default, daftar server video
 * (nilai <option> base64 di-decode), link download (jika ada), dan navigasi
 * episode sebelumnya/berikutnya.
 */
export async function fetchPurtvDetail(url) {
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
  };
}

/**
 * Halaman seri — judul, info detail (status, studio, tipe, dll), genre,
 * sinopsis, dan daftar seluruh episode.
 */
export async function fetchPurtvSeries(url) {
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
  };
}

/** Pencarian donghua (sama dengan kotak pencarian PurTV). */
export async function fetchPurtvSearch(q, page = 1) {
  const url =
    page > 1
      ? `${HOST}/page/${page}/?s=${encodeURIComponent(q)}`
      : `${HOST}/?s=${encodeURIComponent(q)}`;
  const html = await getHtml(url);
  const $ = cheerio.load(html);
  return {
    source: 'purtv.vercel.app',
    query: q,
    page,
    hasNext: hasNextPage($, html),
    results: $('.listupd article.bs').map((_, el) => parseCard($(el))).get(),
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
  };
}

/** Daftar genre donghua (dari /seri/). */
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
  };
}

/**
 * Listing donghua per genre (filter /seri/). Genre diambil dari daftar
 * fetchPurtvGenres; polanya `?page=N&genre%5B0%5D=<slug>`.
 */
export async function fetchPurtvList({ genre = '', page = 1 } = {}) {
  const base = `${HOST}/seri/`;
  const params = [];
  if (genre) params.push(`genre%5B0%5D=${encodeURIComponent(genre)}`);
  if (page > 1) params.push(`page=${page}`);
  const url = `${base}${params.length ? `?${params.join('&')}` : ''}`;
  const html = await getHtml(url);
  const $ = cheerio.load(html);
  const nextHref = $('.hpage a.r, .pagination a.next').first().attr('href');
  return {
    source: 'purtv.vercel.app',
    genre: genre || 'semua',
    page,
    hasNext: !!nextHref || hasNextPage($, html),
    results: $('.listupd article.bs').map((_, el) => parseCard($(el))).get(),
  };
}
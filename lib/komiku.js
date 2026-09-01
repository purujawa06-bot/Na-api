/**
 * Client komiku.org — data komik (manga/manhwa/manhua) tanpa browser.
 * Halaman yang di-render SSR (home, detail, chapter) diambil langsung dari
 * komiku.org. Daftar listing (pustaka, genre, pencarian) dimuat via API
 * internal api.komiku.org (htmx) — juga bisa di-fetch HTTPS biasa.
 * Parsing dengan cheerio (sudah jadi dependency).
 */

import * as cheerio from 'cheerio';

const HOST = 'https://komiku.org';
const API = 'https://api.komiku.org';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36';

export const KOMIKU_TIPES = ['manga', 'manhwa', 'manhua'];

async function getHtml(url) {
  const res = await fetch(url, {
    headers: { 'user-agent': UA, 'accept': 'text/html,*/*' },
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`komiku.org gagal diakses (HTTP ${res.status})`);
  return res.text();
}

function absUrl(path) {
  if (!path) return null;
  return path.startsWith('http') ? path : `${HOST}${path}`;
}

function slugOf(url) {
  const m = String(url).match(/\/manga\/([^/]+)\/?$/);
  return m ? m[1] : null;
}

/**
 * Parse literal objek JS (boleh key polos & string single-quote) jadi objek.
 * Tidak support nested — cukup untuk mangaData/chapterData yang datar.
 */
function parseFlatJsObject(str) {
  const out = {};
  const re = /([A-Za-z_$][\w$]*)\s*:\s*(?:"([^"]*)"|'([^']*)'|([0-9.]+)|(true|false|null))/g;
  let m;
  while ((m = re.exec(str)) !== null) {
    const [, key, dq, sq, num, lit] = m;
    let value;
    if (dq != null) value = dq.replace(/\\\//g, '/').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    else if (sq != null) value = sq.replace(/\\\//g, '/').replace(/\\'/g, "'");
    else if (num != null) value = Number(num);
    else value = lit === 'null' ? null : lit === 'true';
    out[key] = value;
  }
  return out;
}

function getJsonVar($, varName) {
  let html = '';
  $('script').each((_, el) => {
    html += $(el).html() || '';
  });
  const m = html.match(new RegExp(`var ${varName}=(\\{[\\s\\S]*?\\});`));
  if (!m) return null;
  return parseFlatJsObject(m[1]);
}

/**
 * Parse kartu listing `.bge` (dipakai pustaka, genre, dan pencarian).
 */
function parseBgeList($) {
  return $('div.bge')
    .map((_, el) => {
      const $b = $(el);
      const $h3a = $b.find('.kan > a:has(h3)').first();
      const mainHref = $h3a.attr('href');
      const title = $h3a.find('h3').text().trim();
      const cover = $b.find('.bgei img').first().attr('src') || null;
      const tpeTxt = $b.find('.tpe1_inf').first().text().replace(/\s+/g, ' ').trim();
      const [tipe, ...temaArr] = tpeTxt.split(/\s+/).filter(Boolean);
      const syncTxt = $b.find('.kan .judul2').first().text().replace(/\s+/g, ' ').trim();
      const reader = (syncTxt.match(/([0-9.,]+[kjt]*)\s*pembaca/) || [])[1] || null;
      const desc = $b.find('.kan > p').first().text().trim() || null;

      const chapters = {};
      $b.find('.kan .new1').each((_, chEl) => {
        const $a = $(chEl).find('a').first();
        const spans = $a.find('span');
        const label = spans.first().text().replace(/[:\s]/g, '').toLowerCase();
        const chTitle = spans.last().text().trim();
        const url = absUrl($a.attr('href'));
        if (label === 'awal') chapters.first = { title: chTitle, url };
        else if (label === 'terbaru') chapters.latest = { title: chTitle, url };
      });

      return {
        slug: slugOf(mainHref),
        title,
        cover,
        type: tipe || null,
        theme: temaArr.length ? temaArr.join(' ') : null,
        readers: reader,
        synopsis: desc,
        url: absUrl(mainHref),
        chapters,
      };
    })
    .get();
}

function hasNextPage(html) {
  return /page\/(\d+)\//.test(html) || /page=(\d+)/.test(html);
}

/**
 * Beranda komiku.org — seksi SSR (peringkat, populer, terbaru, baru).
 */
export async function fetchKomikuHome() {
  const html = await getHtml(`${HOST}/`);
  const $ = cheerio.load(html);

  const parseLsCard = (selector) =>
    $(selector)
      .map((_, el) => {
        const $a = $(el).find('a[href^="/manga/"]').first();
        const href = $a.attr('href');
        const $article = $(el);
        const rankNum = $article.find('.rank-num').first().text();
        return {
          rank: rankNum ? Number(rankNum) : null,
          slug: slugOf(href),
          title: $article.find('h3,h4').first().text().trim(),
          cover:
            $article.find('img').first().attr('data-src') ||
            $article.find('img').first().attr('src') ||
            null,
          meta: $article.find('.ls2t,.ls4s').first().text().replace(/\s+/g, ' ').trim() || null,
          latestChapter: $article.find('.ls2l,.ls24').first().text().trim() || null,
          url: absUrl(href),
        };
      })
      .get();

  const rank = (id) => parseLsCard(`#${id} article.ls4`);
  const sec = (id) => parseLsCard(`#${id} article.ls2`);

  return {
    source: 'komiku.org',
    ranking: {
      mingguan: rank('rank-mingguan'),
      harian: rank('rank-harian'),
    },
    populer: sec('ls12-populer'),
    terbaru: sec('Terbaru'),
    baruDitambahkan: sec('Baru_Ditambahkan'),
  };
}

/**
 * Listing perpustakaan (pustaka) dengan filter tipe, orderby, genre, status.
 */
export async function fetchKomikuPustaka({
  tipe = '',
  page = 1,
  orderby = '',
  genre = '',
  genre2 = '',
  status = '',
} = {}) {
  const params = new URLSearchParams();
  if (tipe) params.set('tipe', tipe);
  if (orderby) params.set('orderby', orderby);
  if (genre) params.set('genre', genre);
  if (genre2) params.set('genre2', genre2);
  if (status) params.set('status', status);
  const qs = params.toString() ? `?${params}` : '';
  const url = `${API}/manga${page > 1 ? `/page/${page}` : ''}/${qs}`;
  const html = await getHtml(url);
  const $ = cheerio.load(html);
  return {
    source: 'komiku.org',
    tipe: tipe || 'semua',
    page,
    hasNext: hasNextPage(html),
    results: parseBgeList($),
  };
}

/**
 * Detail sebuah manga berdasarkan permalink (slug).
 */
export async function fetchKomikuDetail(slug) {
  const url = `${HOST}/manga/${slug}/`;
  const html = await getHtml(url);
  const $ = cheerio.load(html);
  const mangaJson = getJsonVar($, 'mangaData');
  // mangaData memakai string single-quote (bukan JSON valid) — ambil id via regex
  let id = mangaJson && typeof mangaJson.id !== 'undefined' ? mangaJson.id : null;
  if (id == null) {
    const m = html.match(/var mangaData=\{[^]*?id:['"](\d+)['"]/);
    if (m) id = m[1];
  }
  if (id != null) id = String(id);

  const info = {};
  $('#Informasi .inftable tr').each((_, el) => {
    const tds = $(el).find('td');
    if (tds.length < 2) return;
    const label = $(tds[0]).text().replace(':', '').trim();
    const val = $(tds[1]).text().replace(/\s+/g, ' ').trim();
    if (label) info[label] = val;
  });

  const genre = $('#Informasi .genre li.genre a')
    .map((_, a) => ({
      slug: $(a).attr('href').replace('/genre/', '').replace(/\/$/, ''),
      name: $(a).text().trim(),
    }))
    .get();

  const chapters = [];
  $('#Daftar_Chapter tbody tr').each((_, el) => {
    const a = $(el).find('td.judulseries a').first();
    const href = a.attr('href');
    const date = $(el).find('td.tanggalseries').text().trim();
    if (href && href.includes('-chapter-')) {
      chapters.push({ url: absUrl(href), title: a.text().trim(), date: date || null });
    }
  });

  const related = [];
  $('.grd').each((_, el) => {
    const a = $(el).find('a[href^="/manga/"]').first();
    const href = a.attr('href');
    if (!href) return;
    related.push({
      slug: slugOf(href),
      title: $(el).find('.h4').text().trim(),
      url: absUrl(href),
    });
  });

  const firstChapterLink = $('.linkbutt a[href*="-chapter-"]')
    .filter((_, a) => /awal/i.test($(a).text()))
    .first()
    .attr('href');
  const lastChapterLink = $('.linkbutt a[href*="-chapter-"]')
    .filter((_, a) => /terbaru/i.test($(a).text()))
    .first()
    .attr('href');

  return {
    source: 'komiku.org',
    id,
    slug,
    title: info['Judul'] || null,
    alternativeTitle: info['Judul Alternatif'] || null,
    type: info['Tipe'] || null,
    theme: info['Tema'] || null,
    genre,
    author: info['Author'] || null,
    rating: info['Rating'] || null,
    readers: info['Pembaca'] || null,
    readingDirection: info['Cara Baca'] || null,
    synopsis: $('p.desc').first().text().replace(/\s+/g, ' ').trim() || null,
    chapters: {
      count: chapters.length,
      first: firstChapterLink
        ? { title: $(`.linkbutt a[href="${firstChapterLink}"] span`).last().text().trim(), url: absUrl(firstChapterLink) }
        : null,
      latest: lastChapterLink
        ? { title: $(`.linkbutt a[href="${lastChapterLink}"] span`).last().text().trim(), url: absUrl(lastChapterLink) }
        : null,
      list: chapters,
    },
    related,
    url,
  };
}

/**
 * Reader satu chapter — daftar URL gambar.
 */
export async function fetchKomikuChapter(permalink) {
  let path = String(permalink).trim();
  if (path.startsWith('http')) {
    try {
      path = new URL(path).pathname;
    } catch {
      /* biarkan apa adanya */
    }
  }
  if (!path.startsWith('/')) path = `/${path}`;
  const url = `${HOST}${path}`;
  const html = await getHtml(url);
  const $ = cheerio.load(html);
  const cd = getJsonVar($, 'chapterData') || {};

  const images = [];
  $('#Baca_Komik img').each((_, el) => {
    const src = $(el).attr('src');
    if (!src || /komiku-promosi|komikuplus2/i.test(src)) return;
    images.push(src);
  });

  const seriesUrl = cd.link_series || $('#Judul a[href^="/manga/"]').first().attr('href');

  return {
    source: 'komiku.org',
    id: cd.id ?? null,
    seriesId: cd.idseries ?? null,
    series: cd.series || null,
    chapter: cd.chapter || null,
    imageCount: typeof cd.jumlahgambar === 'number' ? cd.jumlahgambar : null,
    thumbnail: cd.thumbnail || null,
    hasNext: cd.hasNext ?? null,
    seriesUrl: absUrl(seriesUrl),
    images,
    url,
  };
}

/**
 * Daftar semua genre dari halaman perpustakaan (filter). Dipakai melengkapi
 * respons genre dengan daftar genre yang tersedia.
 */
async function fetchGenreList() {
  const html = await getHtml(`${HOST}/pustaka/`);
  const $ = cheerio.load(html);
  return $('select[name="genre"] option[value]')
    .map((_, o) => {
      const v = $(o).attr('value');
      if (!v) return null;
      const raw = $(o).text().trim();
      const name = raw.replace(/\s*\(\d+\)\s*$/, '');
      return { slug: v, name };
    })
    .get()
    .filter(Boolean);
}

/**
 * Listing by genre. Page 1 juga memuat daftar semua genre.
 */
export async function fetchKomikuGenre(slug, page = 1) {
  const url = `${API}/genre/${slug}${page > 1 ? `/page/${page}` : ''}/`;
  const html = await getHtml(url);
  const $ = cheerio.load(html);

  const genres = page === 1 ? await fetchGenreList() : [];

  return {
    source: 'komiku.org',
    genre: slug,
    page,
    hasNext: hasNextPage(html),
    genres,
    results: parseBgeList($),
  };
}

/**
 * Pencarian manga (post_type=manga).
 */
export async function fetchKomikuSearch(q, page = 1) {
  const params = new URLSearchParams({ post_type: 'manga', s: q });
  if (page > 1) params.set('page', page);
  const url = `${API}/?${params}`;
  const html = await getHtml(url);
  const $ = cheerio.load(html);
  return {
    source: 'komiku.org',
    query: q,
    page,
    hasNext: hasNextPage(html),
    results: parseBgeList($),
  };
}

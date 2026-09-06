import * as cheerio from 'cheerio';
import { gotScraping } from 'got-scraping';

/**
 * @module samehadaku
 * @summary Scraper untuk v2.samehadaku.how (WordPress + eastplay theme)
 *
 * Catatan: fetch polos (undici) DIBLOKIR Cloudflare (403) karena fingerprint
 * TLS/HTTP2. got-scraping (tls-client) lolos TLS fingerprinting + Turnstile
 * tanpa eksekusi challenge — lebih robust dari cloudscraper.
 */

const HOST = 'https://v2.samehadaku.how';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36';

// got-scraping default options — TLS fingerprint auto-handle
const DEFAULT_OPTS = {
    headerGeneratorOptions: {
        browsers: [{ name: 'chrome', minVersion: 120 }],
        devices: ['desktop'],
        operatingSystems: ['windows'],
    },
};

const SCHEDULE_DAYS = {
    monday: 'senin',
    tuesday: 'selasa',
    wednesday: 'rabu',
    thursday: 'kamis',
    friday: 'jumat',
    saturday: 'sabtu',
    sunday: 'minggu',
};

// ponytail: key map untuk day Indonesia → English, add when client butuh flexible input
const DAY_KEYS = {
    senin: 'monday', selasa: 'tuesday', rabu: 'wednesday',
    kamis: 'thursday', jumat: 'friday', sabtu: 'saturday', minggu: 'sunday',
};

/** GET HTML via got-scraping — bypass Cloudflare TLS fingerprint */
async function getHtml(url) {
    const res = await gotScraping(url, {
        ...DEFAULT_OPTS,
        headers: { 'user-agent': UA, accept: 'text/html,*/*' },
        timeout: { request: 55000 },
    });
    if (!res.body) throw new Error('samehadaku gagal diakses (body kosong)');
    return res.body;
}

/** GET JSON via got-scraping — bypass Cloudflare TLS fingerprint */
async function getJson(url) {
    const res = await gotScraping(url, {
        ...DEFAULT_OPTS,
        headers: { 'user-agent': UA, accept: 'application/json' },
        timeout: { request: 55000 },
    });
    if (!res.body) throw new Error('samehadaku gagal diakses (body kosong)');
    return JSON.parse(res.body);
}

/** POST form via got-scraping — bypass Cloudflare TLS fingerprint */
async function postForm(url, formBody, extraHeaders = {}) {
    const res = await gotScraping.post(url, {
        ...DEFAULT_OPTS,
        body: formBody,
        headers: {
            'user-agent': UA,
            'content-type': 'application/x-www-form-urlencoded',
            'x-requested-with': 'XMLHttpRequest',
            ...extraHeaders,
        },
        timeout: { request: 55000 },
    });
    if (!res.body) throw new Error('samehadaku gagal diakses (body kosong)');
    return res.body;
}

function absUrl(path) {
    if (!path) return null;
    return path.startsWith('http') ? path : `${HOST}${path}`;
}

function slugOf(url) {
    if (!url) return null;
    const m = url.replace(/\/$/, '').match(/\/([^/]+)$/);
    return m ? m[1] : null;
}

function parsePagination($) {
    const pag = $('nav.pagination, .pagination').first();
    if (!pag.length) return { currentPage: 1, totalPages: 1 };
    const txt = pag.find('span.page-numbers').first().text() || '';
    const m = txt.match(/Page\s+(\d+)\s+of\s+(\d+)/i);
    if (m) return { currentPage: parseInt(m[1], 10), totalPages: parseInt(m[2], 10) };
    return { currentPage: 1, totalPages: 1 };
}

/** parser item .post-show > ul > li (home, terbaru) — CreativeWork */
function parsePostShowItem($, li) {
    const a = $(li).find('.thumb a[itemprop="url"]').first();
    const href = a.attr('href') || null;
    const img = $(li).find('.thumb img').first();
    const epB = $(li).find('.dtla .epx').text().trim();
    const epM = epB.match(/Episode\s+(\d+)/i);
    const author = $(li).find('.dtla span[itemprop="author"]').text().trim() || null;
    const released = $(li).find('.dtla').text().replace(/.*released on:\s*/i, '').trim() || null;
    return {
        title: $(li).find('.dtla h2.entry-title[itemprop="headline"] a').text().trim() || null,
        url: absUrl(href),
        slug: slugOf(href),
        image: absUrl(img.attr('src') || null),
        episode: epM ? epM[1] : null,
        author,
        released,
    };
}

/** parser article.animpost (genre, daftar) — animpost card */
function parseCard($, article) {
    const a = $(article).find('.animposx > a').first();
    const href = a.attr('href') || null;
    const img = $(article).find('.content-thumb img').first();
    const tooltip = $(article).find('.stooltip');
    const genres = [];
    tooltip.find('.genres .mta a').each((_, el) => {
        genres.push($(el).text().trim());
    });
    return {
        title: tooltip.find('.title h4').text().trim() || $(article).find('.data .title h2').text().trim() || null,
        url: absUrl(href),
        slug: slugOf(href),
        image: absUrl(img.attr('src') || null),
        rating: tooltip.find('.metadata span.skor').text().trim() || null,
        synopsis: tooltip.find('.ttls').text().trim() || null,
        genres,
    };
}

/**
 * @summary Ambil beranda samehadaku
 * @returns {Promise<Object>}
 */
export async function fetchSamehadakuHome() {
    try {
        const html = await getHtml(HOST);
        const $ = cheerio.load(html);
        const items = [];
        $('article.post-show > .postshow ul > li[itemscope]').each((_, li) => {
            items.push(parsePostShowItem($, $(li)));
        });
        const pagination = parsePagination($);
        return { source: 'v2.samehadaku.how', homepage: items, pagination };
    } catch (err) {
        return { source: 'v2.samehadaku.how', error: err.message };
    }
}

/**
 * @summary Cari anime di samehadaku
 * @param {string} q - Kata kunci pencarian
 * @returns {Promise<Object>}
 */
export async function fetchSamehadakuSearch(q) {
    if (!q) return { source: 'v2.samehadaku.how', error: 'Parameter q wajib diisi' };
    try {
        const url = `${HOST}/wp-json/eastheme/search/?s=${encodeURIComponent(q)}`;
        const json = await getJson(url);
        // eastplay theme returns array of {id, title, url, image, type, season, studio}
        const results = (Array.isArray(json) ? json : []).map((item) => ({
            id: item.id ?? null,
            title: item.title ?? null,
            url: absUrl(item.url),
            slug: slugOf(item.url),
            image: absUrl(item.image ?? null),
            type: item.type ?? null,
            season: item.season ?? null,
            studio: item.studio ?? null,
        }));
        return { source: 'v2.samehadaku.how', query: q, results };
    } catch (err) {
        return { source: 'v2.samehadaku.how', error: err.message };
    }
}

/**
 * @summary Ambil detail anime
 * @param {string} slug - Slug anime (contoh: "ao-no-hako")
 * @returns {Promise<Object>}
 */
export async function fetchSamehadakuDetail(slug) {
    if (!slug) return { source: 'v2.samehadaku.how', error: 'Parameter slug wajib diisi' };
    try {
        const html = await getHtml(`${HOST}/anime/${slug}/`);
        const $ = cheerio.load(html);
        const article = $('article[itemscope]').first();
        const title = article.find('h1.entry-title[itemprop="name"]').text().trim() || null;
        const poster = absUrl(article.find('.thumb[itemprop="image"] img.anmsa').attr('src') || null);
        const ratingVal = article.find('span[itemprop="ratingValue"]').text().trim() || null;
        const ratingCountEl = article.find('i[itemprop="ratingCount"]').attr('content');
        const desc = article.find('.desc .entry-content[itemprop="description"]').text().trim() || null;
        const genres = [];
        article.find('.genre-info > a[itemprop="genre"]').each((_, el) => {
            const gHref = $(el).attr('href') || null;
            genres.push({
                name: $(el).text().trim(),
                url: absUrl(gHref),
                slug: slugOf(gHref),
            });
        });
        // episodes
        const episodes = [];
        article.find('.lstepsiode.listeps ul li').each((_, li) => {
            const epA = $(li).find('.epsright span.eps a').first();
            const chA = $(li).find('.epsleft span.lchx a').first();
            const date = $(li).find('.epsleft span.date').text().trim() || null;
            episodes.push({
                number: epA.text().trim() || null,
                title: chA.text().trim() || null,
                url: absUrl(chA.attr('href') || epA.attr('href') || null),
                date,
            });
        });
        // info spans (.spe > span)
        const info = {};
        article.find('.spe > span').each((_, span) => {
            const b = $(span).find('b').first();
            if (b.length) {
                const key = b.text().replace(/:$/, '').trim().toLowerCase();
                // value = text setelah <b> di dalam <span>
                const full = $(span).text();
                const val = full.replace(b.text(), '').trim();
                info[key] = val || null;
            }
        });
        return {
            source: 'v2.samehadaku.how',
            title,
            slug,
            url: `${HOST}/anime/${slug}/`,
            poster,
            rating: ratingVal ?? null,
            ratingCount: ratingCountEl ?? null,
            synopsis: desc,
            genres,
            info,
            episodes,
        };
    } catch (err) {
        return { source: 'v2.samehadaku.how', error: err.message };
    }
}

/**
 * @summary Ambil halaman episode (player, download, nav)
 * @param {string} slug - Slug episode (contoh: "black-torch-episode-1")
 * @returns {Promise<Object>}
 */
export async function fetchSamehadakuEpisode(slug) {
    if (!slug) return { source: 'v2.samehadaku.how', error: 'Parameter slug wajib diisi' };
    try {
        const html = await getHtml(`${HOST}/${slug}/`);
        const $ = cheerio.load(html);
        const article = $('article[itemscope]').first();
        const title = article.find('h1.entry-title').text().trim() || null;
        const episodeNum = article.find('span[itemprop="episodeNumber"]').text().trim() || null;
        // servers
        const servers = [];
        article.find('#server ul li .east_player_option').each((_, el) => {
            const e = $(el);
            servers.push({
                name: e.text().trim() || null,
                post: e.attr('data-post') || null,
                nume: e.attr('data-nume') || null,
                type: e.attr('data-type') || null,
            });
        });
        // downloads
        const downloads = [];
        article.find('div.download-eps#downloadb').each((_, block) => {
            const qualities = [];
            $(block).find('ul > li').each((_, li) => {
                const quality = $(li).find('strong').text().trim() || null;
                const hostLinks = [];
                $(li).find('span > a').each((_, a) => {
                    hostLinks.push({
                        host: $(a).text().trim() || null,
                        url: absUrl($(a).attr('href') || null),
                    });
                });
                if (quality || hostLinks.length) qualities.push({ quality, links: hostLinks });
            });
            downloads.push({ qualities });
        });
        // prev/next
        const nav = {};
        const prevA = $('.naveps .prev a').first();
        const nextA = $('.naveps .nvs a:not(.nonex)').last();
        // naveps structure: .nvs a inside .itemleft / .itemright
        const leftA = $('.naveps .itemleft a').first();
        const rightA = $('.naveps .itemright a').last();
        const prevUrl = prevA.attr('href') || leftA.attr('href') || null;
        const nextUrl = nextA.attr('href') || rightA.attr('href') || null;
        // disable check: .nonex class means no prev/next
        const hasPrev = prevUrl && !$('.naveps .itemleft a.nonex').length;
        const hasNext = nextUrl && !$('.naveps .itemright a.nonex').length;
        nav.prev = hasPrev ? { title: (prevA.text() || leftA.text() || '').trim() || null, url: absUrl(prevUrl) } : null;
        nav.next = hasNext ? { title: (nextA.text() || rightA.text() || '').trim() || null, url: absUrl(nextUrl) } : null;
        // related episodes (lstepsiode.listeps)
        const relatedEpisodes = [];
        article.find('.lstepsiode.listeps ul li').each((_, li) => {
            const chA = $(li).find('.epsleft span.lchx a').first();
            const img = $(li).find('.epsright a img').first();
            const date = $(li).find('.epsleft span.date').text().trim() || null;
            relatedEpisodes.push({
                title: chA.text().trim() || null,
                url: absUrl(chA.attr('href') || null),
                image: absUrl(img.attr('src') || null),
                date,
            });
        });
        // anime info sidebar
        const infoAnime = article.find('.infoanime').first();
        const animeTitle = infoAnime.find('.infox h2 a, .infox h2').first().text().trim() || null;
        const animeUrl = absUrl(infoAnime.find('.infox h2 a').attr('href') || null);
        const animePoster = absUrl(infoAnime.find('.thumb img').first().attr('src') || null);
        const synopsis = infoAnime.find('.desc .entry-content').text().trim() || null;
        return {
            source: 'v2.samehadaku.how',
            title,
            slug,
            url: `${HOST}/${slug}/`,
            episode: episodeNum,
            servers,
            downloads,
            navigation: nav,
            relatedEpisodes,
            anime: { title: animeTitle, url: animeUrl, poster: animePoster, synopsis },
        };
    } catch (err) {
        return { source: 'v2.samehadaku.how', error: err.message };
    }
}

/**
 * @summary Ambil data player via AJAX POST
 * @param {string} post - ID post
 * @param {string} nume - Nomor server
 * @param {string} type - Tipe player
 * @returns {Promise<Object>}
 */
export async function fetchSamehadakuPlayer(post, nume, type) {
    if (!post || !nume || !type) return { source: 'v2.samehadaku.how', error: 'Parameter post, nume, type wajib diisi' };
    try {
        const body = new URLSearchParams({
            action: 'player_ajax',
            post,
            nume,
            type,
        });
        const text = await postForm(`${HOST}/wp-admin/admin-ajax.php`, body.toString());
        return { source: 'v2.samehadaku.how', post, nume, type, html: text };
    } catch (err) {
        return { source: 'v2.samehadaku.how', error: err.message };
    }
}

/**
 * @summary Ambil jadwal rilis anime (REST API)
 * @param {string} day - Nama hari Indonesia (senin, selasa, dst) atau English (monday, dst)
 * @returns {Promise<Object>}
 */
export async function fetchSamehadakuJadwal(day) {
    if (!day) return { source: 'v2.samehadaku.how', error: 'Parameter day wajib diisi' };
    const dayLower = day.toLowerCase().trim();
    const dayParam = DAY_KEYS[dayLower] ? dayLower : SCHEDULE_DAYS[dayLower] || dayLower;
    try {
        const url = `${HOST}/wp-json/custom/v1/all-schedule?perpage=20&day=${encodeURIComponent(dayParam)}`;
        const json = await getJson(url);
        const items = (Array.isArray(json) ? json : []).map((item) => ({
            title: item.title ?? null,
            url: absUrl(item.url ?? null),
            slug: slugOf(item.url),
            image: absUrl(item.image ?? null),
            episode: item.episode ?? null,
            time: item.time ?? null,
        }));
        return { source: 'v2.samehadaku.how', day: dayParam, schedule: items };
    } catch (err) {
        return { source: 'v2.samehadaku.how', error: err.message };
    }
}

/**
 * @summary Ambil daftar anime berdasarkan genre
 * @param {string} slug - Slug genre (contoh: "action")
 * @param {number} [page=1] - Nomor halaman
 * @returns {Promise<Object>}
 */
export async function fetchSamehadakuGenre(slug, page = 1) {
    if (!slug) return { source: 'v2.samehadaku.how', error: 'Parameter slug wajib diisi' };
    try {
        const url = page > 1 ? `${HOST}/genre/${slug}/page/${page}/` : `${HOST}/genre/${slug}/`;
        const html = await getHtml(url);
        const $ = cheerio.load(html);
        const items = [];
        $('article.animpost').each((_, article) => {
            items.push(parseCard($, $(article)));
        });
        const pagination = parsePagination($);
        return { source: 'v2.samehadaku.how', genre: slug, page, results: items, pagination };
    } catch (err) {
        return { source: 'v2.samehadaku.how', error: err.message };
    }
}

/**
 * @summary Ambil daftar anime lengkap
 * @param {number} [page=1] - Nomor halaman
 * @returns {Promise<Object>}
 */
export async function fetchSamehadakuDaftar(page = 1) {
    try {
        const url = page > 1 ? `${HOST}/daftar-anime-2/page/${page}/` : `${HOST}/daftar-anime-2/`;
        const html = await getHtml(url);
        const $ = cheerio.load(html);
        const items = [];
        $('article.animpost').each((_, article) => {
            items.push(parseCard($, $(article)));
        });
        const pagination = parsePagination($);
        return { source: 'v2.samehadaku.how', page, results: items, pagination };
    } catch (err) {
        return { source: 'v2.samehadaku.how', error: err.message };
    }
}

/**
 * @summary Ambil anime terbaru
 * @param {number} [page=1] - Nomor halaman
 * @returns {Promise<Object>}
 */
export async function fetchSamehadakuTerbaru(page = 1) {
    try {
        const url = page > 1 ? `${HOST}/anime-terbaru/page/${page}/` : `${HOST}/anime-terbaru/`;
        const html = await getHtml(url);
        const $ = cheerio.load(html);
        const items = [];
        $('article.post-show > .postshow ul > li[itemscope]').each((_, li) => {
            items.push(parsePostShowItem($, $(li)));
        });
        const pagination = parsePagination($);
        return { source: 'v2.samehadaku.how', page, results: items, pagination };
    } catch (err) {
        return { source: 'v2.samehadaku.how', error: err.message };
    }
}

export { SCHEDULE_DAYS };

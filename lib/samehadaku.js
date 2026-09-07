/**
 * @module samehadaku
 * @summary Scraper untuk v2.samehadaku.how (anime sub Indo, WordPress eastplay).
 *
 * Transport memakai scraper-web proxy — SAMA persis seperti frontend
 * purtv.vercel.app (api.js): POST ke `vercel-api-beta-red.vercel.app/api/scraper-web`
 * dengan daftar selektor JSON, proxy yang mengeksekusi selektor lalu balas JSON.
 * Dipilih karena v2.samehadaku.how diblokir Cloudflare (403) utk fetch polos
 * maupun got-scraping dibundle di Next serverless; scraper-web milik PurTV
 * terbukti lolos. (got-scraping tidak dipakai lagi: bundling-nya merusak
 * collect-page-data & chunk runtime Next.)
 */

const HOST = 'https://v2.samehadaku.how';
const PROXY = 'https://vercel-api-beta-red.vercel.app/api/scraper-web';

async function scrape(url, output) {
    const res = await fetch(PROXY, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, output: JSON.stringify(output) }),
    });
    if (!res.ok) throw new Error(`scraper-web gagal diakses (HTTP ${res.status})`);
    return res.json();
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

const CARD_SELECTOR = {
    title: "$(el).find('.data .title h2').text().trim() || null",
    thumbnail: "el => (el.src || null)",
    url: "el => (el.getAttribute('href') || null)",
    type: "$(el).find('.content-thumb .type').text().trim() || null",
    status: "$(el).find('.data .type').text().trim() || null",
    episode: "$(el).find('.score').text().trim() || null",
};

function mapCard(raw) {
    if (!raw) return null;
    return {
        title: raw.title ?? null,
        thumbnail: absUrl(raw.thumbnail),
        url: absUrl(raw.url),
        slug: slugOf(raw.url),
        type: raw.type ?? null,
        status: raw.status ?? null,
        episode: raw.episode ?? null,
    };
}

/**
 * @summary Ambil beranda samehadaku
 * @returns {Promise<Object>}
 */
export async function fetchSamehadakuHome() {
    try {
        const raw = await scrape(HOST, {
            homepage: "$('.post-show ul li').map((i, el) => ({ title: $(el).find('.entry-title a').text().trim(), url: $(el).find('.thumb a').attr('href'), thumbnail: $(el).find('.thumb img').attr('src'), episode: 'Ep ' + $(el).find('.dtla span author').first().text().trim(), author: $(el).find('.dtla span[itemprop=author] author').text().trim() || null, released: $(el).find('.dtla').text().replace(/.*released on:\\s*/i, '').trim() || null })).get()",
            popularAnime: "$('.topten-animesu ul li').map((i, el) => ({ title: $(el).find('.judul').text().trim(), thumbnail: $(el).find('img').attr('src'), url: $(el).find('a').attr('href'), rating: $(el).find('.rating').text().trim(), rank: $(el).find('.is-topten').text().trim() })).get()",
        });
        const homepage = (raw.homepage || []).map((a) => ({
            title: a.title ?? null,
            url: absUrl(a.url),
            slug: slugOf(a.url),
            image: absUrl(a.thumbnail),
            episode: (a.episode || '').replace(/^Ep\s*(\d+)$/, '$1'),
            author: a.author ?? null,
            released: a.released ?? null,
        }));
        return { source: 'v2.samehadaku.how', homepage, popularAnime: raw.popularAnime || [], pagination: {} };
    } catch (err) {
        return { source: 'v2.samehadaku.how', error: err.message };
    }
}

/**
 * @summary Cari anime (HTML, pola PurTV dgn paginasi)
 * @param {string} q - Kata kunci
 * @param {number} [page=1] - Nomor halaman
 * @returns {Promise<Object>}
 */
export async function fetchSamehadakuSearchPage(q, page = 1) {
    if (!q) return { source: 'v2.samehadaku.how', error: 'Parameter q wajib diisi' };
    try {
        const url = page > 1 ? `${HOST}/page/${page}/?s=${encodeURIComponent(q)}` : `${HOST}/?s=${encodeURIComponent(q)}`;
        const raw = await scrape(url, {
            data: "$('article.animpost').map((i, el) => ({ title: $(el).find('.data .title h2').text().trim(), thumbnail: $(el).find('.content-thumb img').attr('src'), url: $(el).find('a').attr('href'), type: $(el).find('.content-thumb .type').text().trim(), status: $(el).find('.data .type').text().trim(), episode: $(el).find('.score').text().trim() })).get()",
            hasNextPage: "$('.pagination .next').length > 0",
        }).catch(() => ({ data: [], hasNextPage: false }));
        return { source: 'v2.samehadaku.how', query: q, page, results: (raw.data || []).map(mapCard), hasNext: !!raw.hasNextPage };
    } catch (err) {
        return { source: 'v2.samehadaku.how', error: err.message, results: [], hasNext: false };
    }
}

/**
 * @summary Ambil daftar anime per genre (pola PurTV dgn paginasi)
 * @param {string} slug - Slug genre (contoh: "action")
 * @param {number} [page=1] - Nomor halaman
 * @returns {Promise<Object>}
 */
export async function fetchSamehadakuGenrePage(slug, page = 1) {
    if (!slug) return { source: 'v2.samehadaku.how', error: 'Parameter slug wajib diisi' };
    try {
        const url = page > 1 ? `${HOST}/genre/${slug}/page/${page}/?order=latest` : `${HOST}/genre/${slug}/?order=latest`;
        const raw = await scrape(url, {
            data: "$('article.animpost').map((i, el) => ({ title: $(el).find('.data .title h2').text().trim(), thumbnail: $(el).find('.content-thumb img').attr('src'), url: $(el).find('a').attr('href'), type: $(el).find('.content-thumb .type').text().trim(), status: $(el).find('.data .type').text().trim(), episode: $(el).find('.score').text().trim() })).get()",
            hasNextPage: "$('.pagination .arrow_pag').length > 0",
        }).catch(() => ({ data: [], hasNextPage: false }));
        return { source: 'v2.samehadaku.how', genre: slug, page, results: (raw.data || []).map(mapCard), hasNext: !!raw.hasNextPage };
    } catch (err) {
        return { source: 'v2.samehadaku.how', error: err.message, results: [], hasNext: false };
    }
}

/**
 * @summary Ambil detail anime (halaman /anime/<slug>/)
 * @param {string} slug - Slug anime
 * @returns {Promise<Object>}
 */
export async function fetchSamehadakuDetail(slug) {
    if (!slug) return { source: 'v2.samehadaku.how', error: 'Parameter slug wajib diisi' };
    try {
        const raw = await scrape(`${HOST}/anime/${slug}/`, {
            title: "$('.entry-header .entry-title').text().replace('Sub Indo', '').trim() || $('.anim-detail').text().replace('Detail Anime ', '').trim()",
            thumbnail: "$('.thumb img').attr('src')",
            rating: "$('.archiveanime-rating span').first().text().trim() || $('.rating strong').text().replace('Rating', '').trim() || '?'",
            status: "$('.spe span:contains(\"Status\")').text().replace('Status', '').trim()",
            studio: "$('.spe span:contains(\"Studio\")').text().replace('Studio', '').trim()",
            updated_on: "$('.spe span:contains(\"Released\")').text().replace('Released:', '').trim()",
            type: "$('.spe span:contains(\"Type\")').text().replace('Type', '').trim()",
            genres: "$('.genre-info a').map((i, el) => $(el).text().trim()).get()",
            synopsis: "$('.desc .entry-content').text().trim()",
            episodeList: "$('.lstepsiode.listeps ul li').map((i, el) => ({ title: $(el).find('.lchx a').text().trim(), number: $(el).find('.eps a').text().trim(), url: $(el).find('.lchx a').attr('href') })).get()",
        });
        const info = {};
        if (raw.status) info.status = raw.status;
        if (raw.studio) info.studio = raw.studio;
        if (raw.updated_on) info.updated_on = raw.updated_on;
        if (raw.type) info.type = raw.type;
        return {
            source: 'v2.samehadaku.how',
            title: raw.title || null,
            slug,
            url: `${HOST}/anime/${slug}/`,
            poster: absUrl(raw.thumbnail),
            rating: raw.rating || null,
            synopsis: raw.synopsis || null,
            genres: (raw.genres || []).map((name) => ({ name, url: null, slug: null })),
            info,
            episodes: (raw.episodeList || []).map((e) => ({
                number: e.number ?? null,
                title: e.title ?? null,
                url: absUrl(e.url),
                date: null,
            })),
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
        const raw = await scrape(`${HOST}/${slug}/`, {
            title: "$('.entry-title').text().trim()",
            series: "$('#breadcrumbs ol li:nth-child(3) a span').text().trim() || $('.breadcrumb span:nth-child(3) a span').text().trim()",
            seriesUrl: "$('#breadcrumbs ol li:nth-child(3) a').attr('href') || $('.breadcrumb span:nth-child(3) a').attr('href')",
            streamingLinks: "$('#server ul li .east_player_option').map((i, el) => ({ name: $(el).text().trim(), post: $(el).attr('data-post'), nume: $(el).attr('data-nume'), type: $(el).attr('data-type') })).get()",
            downloadLinks: "$('.download-eps').map((i, el) => { const cat = $(el).find('p b').text().trim(); return $(el).find('ul li').map((j, li) => ({ quality: (cat + ' ' + $(li).find('strong').text().trim()).trim(), links: $(li).find('span a').map((k, a) => ({ host: $(a).text().trim(), url: $(a).attr('href') })).get() })).get(); }).get().flat()",
            prevEpisode: "$('.naveps .nvs a:not(.nonex)').first().attr('href')",
            allEpisodes: "$('.naveps .nvsc a').attr('href')",
            nextEpisode: "$('.naveps .rght a:not(.nonex)').first().attr('href')",
        });
        const servers = (raw.streamingLinks || []).map((s) => ({
            name: s.name ?? null,
            post: s.post ?? null,
            nume: s.nume ?? null,
            type: s.type ?? null,
        }));
        const downloads = (raw.downloadLinks && raw.downloadLinks.length ? [{ qualities: raw.downloadLinks }] : []).map((d) => ({
            qualities: d.qualities.map((q) => ({
                quality: q.quality || null,
                links: (q.links || []).map((l) => ({ host: l.host, url: absUrl(l.url) })),
            })),
        }));
        const navigation = {};
        if (raw.prevEpisode) navigation.prev = { title: null, url: absUrl(raw.prevEpisode) };
        if (raw.nextEpisode) navigation.next = { title: null, url: absUrl(raw.nextEpisode) };
        const allEpisodes = absUrl(raw.allEpisodes);
        return {
            source: 'v2.samehadaku.how',
            title: raw.title || null,
            slug,
            url: `${HOST}/${slug}/`,
            episode: null,
            servers,
            downloads,
            navigation,
            relatedEpisodes: [],
            anime: {
                title: raw.series || null,
                url: absUrl(raw.seriesUrl) || allEpisodes,
                poster: null,
                synopsis: null,
            },
        };
    } catch (err) {
        return { source: 'v2.samehadaku.how', error: err.message };
    }
}
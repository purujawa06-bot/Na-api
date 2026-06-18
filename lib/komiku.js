const cloudscraper = require('cloudscraper');
const cheerio = require('cheerio');

const BASE_URL = 'https://komiku.org';
const API_URL = 'https://api.komiku.org';

const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    'Referer': BASE_URL,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
    'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7'
};

function fixUrl(url, base = BASE_URL) {
    if (!url) return null;
    if (url.startsWith('http')) return url;
    if (url.startsWith('//')) return `https:${url}`;
    return base + (url.startsWith('/') ? '' : '/') + url;
}

const makeProxyLink = (originalUrl, type, apiBaseUrl) => {
    if (!apiBaseUrl) return originalUrl;
    const endpoint = type === 'read' ? 'read' : type === 'image' ? 'image-proxy' : 'detail';
    return `${apiBaseUrl}/api/anime/komiku/${endpoint}?url=${encodeURIComponent(originalUrl)}`;
};

async function scrapeHome(apiBaseUrl) {
    try {
        const data = await cloudscraper.get({ uri: BASE_URL, headers });
        const $ = cheerio.load(data);
        const updates = [];

        $('#Terbaru article.ls2').each((i, element) => {
            const title = $(element).find('h3 a').text().trim() || $(element).find('h3').text().trim();
            const link = $(element).find('h3 a').attr('href') || $(element).find('a').first().attr('href');

            if (link && link.includes('/plus/')) return;

            const typeRaw = $(element).find('.ls2t').text().trim();
            const type = typeRaw.split(' · ')[0] || 'Unknown'; 

            const chapter = $(element).find('.ls2l').text().trim();
            const chapterLink = $(element).find('.ls2l').attr('href');

            const thumbRaw = $(element).find('img.lazy').attr('data-src') || $(element).find('img').attr('src');
            
            const fixedLink = fixUrl(link);
            const fixedChapterLink = fixUrl(chapterLink);

            updates.push({
                title,
                type,
                chapter,
                update_info: typeRaw,
                thumbnail: fixUrl(thumbRaw),
                originalLink: fixedLink,
                link: makeProxyLink(fixedLink, 'detail', apiBaseUrl),
                originalChapterLink: fixedChapterLink,
                chapter_link: makeProxyLink(fixedChapterLink, 'read', apiBaseUrl)
            });
        });

        return updates;
    } catch (error) {
        console.error('Gagal scrape Home:', error.message);
        throw error;
    }
}

async function scrapeSearch(query, apiBaseUrl) {
    try {
        const searchUrl = `${API_URL}?post_type=manga&s=${encodeURIComponent(query)}`;
        const data = await cloudscraper.get({ uri: searchUrl, headers });

        const $ = cheerio.load(data);
        const results = [];

        $('.bge').each((i, element) => {
            const $bgei = $(element).find('.bgei');
            const $kan = $(element).find('.kan');

            let title = $kan.find('h3').text().trim();
            if (!title) {
                title = $bgei.find('img').attr('alt') || $kan.find('a').first().text().trim();
            }

            const link = $kan.find('a').attr('href') || $bgei.find('a').attr('href');
            const thumbRaw = $bgei.find('img').attr('data-src') || $bgei.find('img').attr('src');
            const description = $kan.find('p').text().trim();
            const type = $bgei.find('.tpe1_inf b').text().trim() || $bgei.find('.tpe1_inf').text().trim().split(' ')[0] || 'Unknown';

            const fixedLink = fixUrl(link);

            results.push({
                title,
                type,
                thumbnail: fixUrl(thumbRaw),
                description,
                originalLink: fixedLink,
                link: makeProxyLink(fixedLink, 'detail', apiBaseUrl)
            });
        });

        return results;
    } catch (error) {
        console.error('Gagal scrape Search:', error.message);
        throw error;
    }
}

async function scrapePopular(page = 1, apiBaseUrl) {
    try {
        const targetUrl = `${API_URL}/other/hot/page/${page}/`;
        const data = await cloudscraper.get({ uri: targetUrl, headers });
        const $ = cheerio.load(data);
        const results = [];

        $('.bge').each((i, element) => {
            const $bgei = $(element).find('.bgei');
            const $kan = $(element).find('.kan');

            let title = $kan.find('h3').text().trim();
            if (!title) {
                title = $bgei.find('img').attr('alt') || $kan.find('a').first().text().trim();
            }

            const link = $kan.find('a').attr('href') || $bgei.find('a').attr('href');
            const thumbRaw = $bgei.find('img').attr('data-src') || $bgei.find('img').attr('src');
            const description = $kan.find('p').text().trim();
            const type = $bgei.find('.tpe1_inf b').text().trim() || $bgei.find('.tpe1_inf').text().trim().split(' ')[0] || 'Unknown';
            const updateInfo = $(element).find('.up').text().trim();

            const fixedLink = fixUrl(link);

            results.push({
                title,
                type,
                update_info: updateInfo,
                thumbnail: fixUrl(thumbRaw),
                description,
                originalLink: fixedLink,
                link: makeProxyLink(fixedLink, 'detail', apiBaseUrl)
            });
        });

        return results;
    } catch (error) {
        console.error('Gagal scrape Popular:', error.message);
        throw error;
    }
}

async function scrapeDetail(url, apiBaseUrl) {
    try {
        const data = await cloudscraper.get({ uri: url, headers });
        const $ = cheerio.load(data);

        const title = $('#Judul h1 span').first().text().trim();
        const indoTitle = $('p.j2').text().trim();
        const description = $('.desc').text().trim();
        const thumbnail = fixUrl($('.ims img').attr('src'));

        const info = {};
        $('.inftable tr').each((i, el) => {
            const key = $(el).find('td').eq(0).text().trim().replace(/\s+/g, '_').toLowerCase();
            const val = $(el).find('td').eq(1).text().trim();
            if(key) info[key] = val;
        });

        const genres = [];
        $('.genre li a').each((i, el) => {
            genres.push($(el).text().trim());
        });

        const chapters = [];
        $('#Daftar_Chapter tbody tr').each((i, el) => {
            if ($(el).find('th').length > 0) return;

            const chTitle = $(el).find('td.judulseries a span').text().trim();
            const chLink = $(el).find('td.judulseries a').attr('href');
            const date = $(el).find('td.tanggalseries').text().trim();
            const views = $(el).find('td.pembaca i').text().trim();

            if (chTitle && chLink) {
                const fixedChLink = fixUrl(chLink);
                chapters.push({
                    title: chTitle,
                    date,
                    views,
                    originalLink: fixedChLink,
                    link: makeProxyLink(fixedChLink, 'read', apiBaseUrl)
                });
            }
        });

        return {
            title,
            indo_title: indoTitle,
            thumbnail,
            description,
            info,
            genres,
            chapters
        };

    } catch (error) {
        console.error('Gagal scrape Detail:', error.message);
        throw error;
    }
}

async function scrapeChapter(url, apiBaseUrl) {
    try {
        const data = await cloudscraper.get({ uri: url, headers });
        const $ = cheerio.load(data);

        const chapterTitle = $('#Judul h1').text().trim();
        const images = [];

        $('#Baca_Komik img').each((i, el) => {
            let imgUrl = $(el).attr('src');
            if (!imgUrl || imgUrl.includes('loading') || !imgUrl.startsWith('http')) {
                imgUrl = $(el).attr('data-src') || $(el).attr('src');
            }

            if (imgUrl && !imgUrl.includes('komikuplus')) {
                const fixed = fixUrl(imgUrl);
                images.push({
                    index: i + 1,
                    url: apiBaseUrl ? makeProxyLink(fixed, 'image', apiBaseUrl) : fixed,
                    alt: $(el).attr('alt') || `Gambar ${i+1}`
                });
            }
        });

        return {
            title: chapterTitle,
            images
        };

    } catch (error) {
        console.error('Gagal scrape Chapter:', error.message);
        throw error;
    }
}

module.exports = { scrapeHome, scrapeSearch, scrapePopular, scrapeDetail, scrapeChapter };
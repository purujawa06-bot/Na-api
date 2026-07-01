/**
 * MAL Scraper — Scrape langsung dari myanimelist.net
 * Menggantikan Jikan API yang sedang bermasalah (504 Gateway Timeout).
 * 
 * Menggunakan native fetch() + cheerio.
 * Ketika Jikan pulih, bisa dikembalikan dengan mengganti isi fungsi2 di bawah.
 */

let cheerio;
try {
    cheerio = require('cheerio');
} catch {
    // Fallback jika cheerio tidak terinstall (harusnya ada via package.json)
    cheerio = null;
}

const BASE = 'https://myanimelist.net';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

async function fetchHTML(url) {
    const res = await fetch(url, {
        headers: {
            'User-Agent': UA,
            'Accept': 'text/html,application/xhtml+xml',
            'Accept-Language': 'en-US,en;q=0.5'
        }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
    return await res.text();
}

/**
 * Parse item dari seasonal/genre page (.js-anime-category-producer)
 */
function parseSeasonalItem($, el) {
    const $el = $(el);
    const titleEl = $el.find('.link-title, h2 a').first();
    const title = titleEl.text().trim();
    const link = titleEl.attr('href') || '';
    const malId = link.match(/\/anime\/(\d+)/)?.[1] || '';
    const img = $el.find('img').first().attr('data-src') || $el.find('img').first().attr('src') || '';
    const score = parseFloat($el.find('.js-score').first().text().trim()) || 0;
    const members = parseInt($el.find('.js-members').first().text().trim()) || 0;
    const type = ($el.attr('class') || '').match(/js-anime-type-(\d+)/)?.[1] || '';
    const synopsis = $el.find('.synopsis, .pre-line').first().text().trim();
    
    // Episode info dari informasi
    const infoText = $el.find('.info').text().trim();
    
    // Extract type from info text if available
    const typeMap = { '1': 'TV', '2': 'OVA', '3': 'Movie', '4': 'Special', '5': 'ONA', '6': 'Music' };
    const typeName = typeMap[type] || (infoText.match(/^(TV|Movie|OVA|ONA|Special|Music)/)?.[1] || '');
    
    // Extract episodes from info
    const epMatch = infoText.match(/(\d+)\s*eps?/i);
    const episodes = epMatch ? parseInt(epMatch[1]) : null;
    
    return {
        mal_id: parseInt(malId) || 0,
        title: title,
        images: {
            jpg: {
                image_url: img,
                small_image_url: img.replace('/r/50x70', '/r/50x70') || img,
                large_image_url: img.replace('/r/50x70', '') || img
            }
        },
        score: score,
        type: typeName || type,
        episodes: episodes,
        members: members,
        synopsis: synopsis,
        url: link
    };
}

/**
 * Parse item dari search table rows
 */
function parseSearchRow($, row) {
    const $row = $(row);
    
    // Image & link
    const linkEl = $row.find('a.hoverinfo_trigger').first();
    const link = linkEl.attr('href') || '';
    const malId = link.match(/\/anime\/(\d+)/)?.[1] || '';
    const img = $row.find('img').first().attr('data-src') || $row.find('img').first().attr('src') || '';
    const title = $row.find('.js-title, .title a, a.hoverinfo_trigger[href*="/anime/"]').first().text().trim() || 
                  $row.find('td:nth-child(2) a').first().text().trim();
    
    // Type (TV, Movie, etc)
    const type = $row.find('td:nth-child(3)').text().trim();
    
    // Episode count
    const episodes = $row.find('td:nth-child(4)').text().trim();
    
    // Score
    const scoreText = $row.find('td:nth-child(5)').text().trim();
    const score = parseFloat(scoreText) || 0;
    
    return {
        mal_id: parseInt(malId) || 0,
        title: title,
        images: {
            jpg: {
                image_url: img
            }
        },
        score: score,
        type: type,
        episodes: episodes ? parseInt(episodes) || episodes : null,
        url: link
    };
}

/**
 * Parse item dari top anime ranking
 */
function parseTopRow($, row) {
    const $row = $(row);
    const rank = parseInt($row.find('.top-anime-rank-text').text().trim()) || 0;
    const title = $row.find('.detail .js-title').text().trim() || $row.find('.js-title').text().trim();
    const score = parseFloat($row.find('.score span, td.score').text().trim()) || 0;
    const link = $row.find('a.hoverinfo_trigger').first().attr('href') || '';
    const malId = link.match(/\/anime\/(\d+)/)?.[1] || '';
    const img = $row.find('img').first().attr('data-src') || $row.find('img').first().attr('src') || '';
    
    // Info: type, episodes, dates, members
    const infoText = $row.find('.information').text().trim();
    const typeMatch = infoText.match(/^([A-Za-z]+)/);
    const type = typeMatch ? typeMatch[1] : '';
    const epMatch = infoText.match(/(\d+)\s*eps?/i);
    const episodes = epMatch ? parseInt(epMatch[1]) : null;
    const memMatch = infoText.match(/([\d,]+)\s*members/i);
    const members = memMatch ? parseInt(memMatch[1].replace(/,/g, '')) : 0;
    
    return {
        mal_id: parseInt(malId) || 0,
        rank: rank,
        title: title,
        images: {
            jpg: {
                image_url: img,
                small_image_url: img.replace('/r/50x70', '/r/50x70') || img,
                large_image_url: img.replace('/r/50x70', '') || img
            }
        },
        score: score,
        type: type,
        episodes: episodes,
        members: members,
        url: link
    };
}

/**
 * Parse MAL pagination dari "next" link
 */
function parsePagination($) {
    const nextLink = $('link[rel="next"]').attr('href');
    const hasNextPage = !!nextLink;
    
    // Current items count
    const itemsCount = $('tr.ranking-list, .js-anime-category-producer').length;
    
    return {
        has_next_page: hasNextPage,
        items: {
            count: itemsCount
        }
    };
}

const mal = {
    /**
     * Get Top Anime dari myanimelist.net/topanime.php
     */
    getTopAnime: async (page = 1, limit = 50) => {
        const offset = (page - 1) * 50;
        const url = `${BASE}/topanime.php?limit=${offset}`;
        const html = await fetchHTML(url);
        const $ = cheerio.load(html);
        
        const data = [];
        $('tr.ranking-list').each((i, el) => {
            if (data.length >= limit) return false;
            data.push(parseTopRow($, el));
        });
        
        return {
            data: data,
            pagination: {
                current_page: page,
                has_next_page: data.length >= limit || $('link[rel="next"]').length > 0,
                items: { count: data.length, per_page: limit }
            }
        };
    },

    /**
     * Get Seasonal/Ongoing Anime dari myanimelist.net/anime/season
     */
    getSeasonNow: async (page = 1, limit = 50) => {
        const url = `${BASE}/anime/season`;
        const html = await fetchHTML(url);
        const $ = cheerio.load(html);
        
        const data = [];
        $('.js-anime-category-producer').each((i, el) => {
            if (data.length >= limit) return false;
            data.push(parseSeasonalItem($, el));
        });
        
        return {
            data: data,
            pagination: {
                current_page: 1,
                has_next_page: false,
                items: { count: data.length, per_page: limit }
            }
        };
    },

    /**
     * Search Anime di myanimelist.net
     */
    searchAnime: async (q, page = 1, limit = 50) => {
        const offset = (page - 1) * 50;
        const url = `${BASE}/anime.php?q=${encodeURIComponent(q)}&cat=anime&show=${offset}`;
        const html = await fetchHTML(url);
        const $ = cheerio.load(html);
        
        const data = [];
        // Search results are in a table with rows containing hoverinfo_trigger links
        $('table[border="0"][cellpadding="0"] tr').each((i, el) => {
            if (data.length >= limit) return false;
            const $el = $(el);
            // Skip header rows and rows without anime links
            if (!$el.find('a.hoverinfo_trigger[href*="/anime/"]').length) return;
            if ($el.find('td.borderClass').length < 3) return;
            
            data.push(parseSearchRow($, el));
        });
        
        // Fallback: find all hoverinfo_trigger links with anime IDs
        if (data.length === 0) {
            $('a.hoverinfo_trigger[href*="/anime/"][id^="sarea"]').each((i, el) => {
                if (data.length >= limit) return false;
                const $el = $(el);
                const link = $el.attr('href') || '';
                const malId = link.match(/\/anime\/(\d+)/)?.[1] || '';
                const img = $el.find('img').first().attr('data-src') || $el.find('img').first().attr('src') || '';
                const title = $el.find('img').first().attr('alt') || '';
                
                data.push({
                    mal_id: parseInt(malId) || 0,
                    title: title,
                    images: { jpg: { image_url: img } },
                    score: 0,
                    url: link
                });
            });
        }
        
        return {
            data: data,
            pagination: {
                current_page: page,
                has_next_page: $('link[rel="next"]').length > 0,
                items: { count: data.length, per_page: limit }
            }
        };
    },

    /**
     * Get Anime by Genre dari myanimelist.net/anime/genre/{genreId}
     */
    getAnimeByGenre: async (genreId, page = 1, limit = 50) => {
        const offset = (page - 1) * 50;
        const url = `${BASE}/anime/genre/${genreId}?show=${offset}`;
        const html = await fetchHTML(url);
        const $ = cheerio.load(html);
        
        const data = [];
        $('.js-anime-category-producer').each((i, el) => {
            if (data.length >= limit) return false;
            data.push(parseSeasonalItem($, el));
        });
        
        return {
            data: data,
            pagination: {
                current_page: page,
                has_next_page: $('link[rel="next"]').length > 0,
                items: { count: data.length, per_page: limit }
            }
        };
    }
};

module.exports = mal;

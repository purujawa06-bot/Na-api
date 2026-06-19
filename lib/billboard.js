const cloudscraper = require('cloudscraper');
const cheerio = require('cheerio');

/**
 * Scrape Billboard Indonesia Songs chart
 * @returns {Promise<Array>} Array of {rank, title, artist, lastWeek, peakPos, weeksOnChart, image}
 */
async function billboardIndonesia() {
    const url = 'https://www.billboard.com/charts/indonesia-songs-hotw/';
    
    const html = await cloudscraper.get({ uri: url });
    const $ = cheerio.load(html);
    
    const results = [];
    
    // Chart rows: ul.o-chart-results-list-row
    $('ul.o-chart-results-list-row').each((i, el) => {
        const row = $(el);
        
        // Rank: first li > span.c-label.a-font-basic
        const rank = row.find('> li.o-chart-results-list__item:first-child span.c-label.a-font-basic').first().text().trim();
        
        // Title: h3.c-title.a-font-basic
        const title = row.find('h3.c-title.a-font-basic').first().text().trim();
        
        // Artist: span.c-label.a-no-trucate.a-font-secondary
        const artist = row.find('span.c-label.a-no-trucate.a-font-secondary').first().text().trim();
        
        // Metadata (lastWeek, peakPos, weeksOnChart) from nested flex container
        const metas = [];
        row.find('div.lrv-u-flex\\@desktop div.lrv-u-flex li span.c-label').each((j, sp) => {
            const txt = $(sp).text().trim();
            if (txt && !isNaN(txt)) metas.push(txt);
        });
        
        // Image: fallback chain
        const imgEl = row.find('img.c-lazy-image__img').first();
        const image = imgEl.attr('data-lazy-src') || imgEl.attr('src') || '';
        
        if (title) {
            results.push({
                rank: parseInt(rank) || (i + 1),
                title,
                artist,
                lastWeek: metas[0] || '-',
                peakPos: metas[1] || '-',
                weeksOnChart: metas[2] || '-',
                image
            });
        }
    });
    
    return results;
}

module.exports = { billboardIndonesia };

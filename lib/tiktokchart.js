const cloudscraper = require('cloudscraper');

/**
 * Scrape TikTok chart Indonesia from Soundcharts
 * @returns {Promise<Array>} Array of {position, title, artist, songId}
 */
async function tiktokChartIndonesia() {
    const url = 'https://soundcharts.com/en/charts/tiktok/indonesia';
    
    const html = await cloudscraper.get({ uri: url, timeout: 30000 });
    
    // Find the JSON-LD script containing ItemList (chart data)
    const match = html.match(
        /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi
    );
    
    if (!match) throw new Error('No JSON-LD scripts found');
    
    let chartData = null;
    for (const scriptTag of match) {
        const jsonMatch = scriptTag.replace(/<\/?script[^>]*>/gi, '');
        try {
            const parsed = JSON.parse(jsonMatch);
            if (
                parsed['@type'] === 'ItemList' &&
                parsed.name &&
                parsed.name.includes('TikTok')
            ) {
                chartData = parsed;
                break;
            }
        } catch (_) {
            // skip invalid JSON
        }
    }
    
    if (!chartData || !chartData.itemListElement) {
        throw new Error('Could not find TikTok chart data in page');
    }
    
    const results = chartData.itemListElement.map(item => {
        const song = item.item;
        const position = item.position;
        const title = song.name;
        const artist = song.byArtist ? song.byArtist.name : 'Unknown';
        const songId = song.url ? song.url.split('/').pop() : '';
        
        return {
            position,
            title,
            artist,
            songId
        };
    });
    
    return results;
}

module.exports = { tiktokChartIndonesia };
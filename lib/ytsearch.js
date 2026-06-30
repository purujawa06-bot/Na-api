const axios = require('axios');

const BASE_URL = 'https://inv.nadeko.net';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/**
 * YouTube Search via Invidious (inv.nadeko.net) — without cheerio
 *
 * @param {string} query - Kata kunci pencarian
 * @param {object} [options]
 * @param {number} [options.page] - Halaman (default: 1)
 * @param {string} [options.sort] - Sort: 'relevance' | 'views' | 'rating' | 'date'
 * @param {string} [options.duration] - Durasi: 'short' | 'medium' | 'long'
 * @param {string} [options.type] - Tipe: 'video' | 'channel' | 'playlist' | 'movie' | 'show'
 * @param {string} [options.date] - Upload: 'hour' | 'today' | 'week' | 'month' | 'year'
 * @returns {Promise<Array>}
 */
async function search(query, options = {}) {
    if (!query || typeof query !== 'string') {
        throw new Error('Query is required.');
    }

    const page = options.page || 1;
    const params = new URLSearchParams({ q: query, page });

    if (options.sort) params.set('sort', options.sort);
    if (options.duration) params.set('duration', options.duration);
    if (options.type) params.set('type', options.type);
    if (options.date) params.set('date', options.date);
    if (options.features) {
        const features = Array.isArray(options.features) ? options.features : [options.features];
        features.forEach((f) => params.append('features[]', f));
    }

    const url = `${BASE_URL}/search?${params.toString()}`;

    const { data } = await axios.get(url, {
        headers: {
            'User-Agent': USER_AGENT,
            Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
        },
        timeout: 15000,
    });

    const results = [];

    // Split by card: each card starts with <div class="pure-u-1 pure-u-md-1-4
    // Each part already contains the complete card content (until next card or end)
    const cardOpen = '<div class="pure-u-1 pure-u-md-1-4';
    const parts = data.split(cardOpen);

    // Skip first part (before first card)
    for (let i = 1; i < parts.length; i++) {
        const cardHtml = parts[i];

        // -- Extract title --
        // Title: <a href="/watch?v=..."><p dir="auto">TITLE</p></a>
        const titleMatch = cardHtml.match(/<a href="\/watch\?v=[a-zA-Z0-9_-]{11}"><p[^>]*>([\s\S]*?)<\/p><\/a>/);
        if (!titleMatch) continue;
        const title = titleMatch[1]
            .replace(/<[^>]+>/g, '')
            .replace(/&amp;/g, '&')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&#x2F;/g, '/')
            .trim();
        if (!title) continue;

        // -- Video ID --
        const vidMatch = cardHtml.match(/\/watch\?v=([a-zA-Z0-9_-]{11})/);
        const videoId = vidMatch ? vidMatch[1] : '';

        // -- Extract duration --
        const durMatch = cardHtml.match(/<p class="length">([\s\S]*?)<\/p>/);
        const duration = durMatch ? durMatch[1].trim() : '';

        // -- Extract thumbnail --
        const thumbMatch = cardHtml.match(/<img[^>]*src="([^"]+)"[^>]*>/);
        let thumbnail = '';
        if (thumbMatch) {
            thumbnail = thumbMatch[1].startsWith('http') ? thumbMatch[1] : BASE_URL + thumbMatch[1];
        }

        // -- Extract channel name --
        const chMatch = cardHtml.match(/<p class="channel-name"[^>]*>([\s\S]*?)<\/p>/);
        let channel = '';
        if (chMatch) {
            channel = chMatch[1]
                .replace(/<[^>]+>/g, '')
                .replace(/&nbsp;/g, ' ')
                .replace(/&amp;/g, '&')
                .trim();
        }

        // -- Channel ID --
        const chIdMatch = cardHtml.match(/\/channel\/(UC[a-zA-Z0-9_-]+)/);
        const channelId = chIdMatch ? chIdMatch[1] : '';

        // -- Extract views & published from .video-data --
        const videoDataMatches = [...cardHtml.matchAll(/<p class="video-data"[^>]*>([\s\S]*?)<\/p>/g)];
        let published = '';
        let views = '';
        for (const vdMatch of videoDataMatches) {
            const text = vdMatch[1]
                .replace(/<[^>]+>/g, '')
                .replace(/&nbsp;/g, ' ')
                .trim();
            if (/views?/i.test(text)) {
                views = text;
            } else if (/(Shared|Streamed|Premiered|ago)/i.test(text)) {
                published = text;
            }
        }

        results.push({
            title,
            url: `https://www.youtube.com/watch?v=${videoId}`,
            videoId,
            channel,
            channelId,
            channelUrl: channelId ? `https://www.youtube.com/channel/${channelId}` : '',
            duration,
            thumbnail,
            views,
            published,
        });
    }

    return results;
}

module.exports = { search };
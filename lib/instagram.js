/**
 * Instagram Scraper & Downloader
 * Mengambil metadata + link download dari URL Instagram (Reel/Post/Carousel)
 * 
 * Strategy:
 * 1. Scrape OG meta tags dari Instagram page (?__a=1&__d=1) -> Metadata (caption, author, thumbnail, likes, comments, date)
 * 2. VDFRDownloader -> Link download video/image
 */
const axios = require('axios');
const cheerio = require('cheerio');
const VDFRDownloader = require('./vdfr-downloader');

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

/**
 * Extract shortcode dari berbagai format URL Instagram
 * @param {string} url 
 * @returns {string|null}
 */
function extractShortcode(url) {
    if (!url) return null;
    
    const patterns = [
        /instagram\.com\/(?:reel|p|tv|reels)\/([a-zA-Z0-9_-]+)/,
    ];
    
    for (const pattern of patterns) {
        const match = url.match(pattern);
        if (match && match[1]) {
            const code = match[1];
            if (code.length >= 5 && !['embed', 'tagged', 'explore', 'stories', 'direct'].includes(code)) {
                return code;
            }
        }
    }
    
    return null;
}

/**
 * Parse og:description untuk extrak metadata terstruktur
 * Format: "2,022 likes, 2 comments - username on March 15, 2026: caption text"
 * @param {string} description 
 * @returns {object}
 */
function parseOgDescription(description) {
    if (!description) return {};
    
    const result = {};
    
    // Extract likes count
    const likesMatch = description.match(/([\d,]+)\s+likes?/);
    if (likesMatch) {
        result.likes = parseInt(likesMatch[1].replace(/,/g, ''), 10) || 0;
    }
    
    // Extract comments count
    const commentsMatch = description.match(/([\d,]+)\s+comments?/);
    if (commentsMatch) {
        result.comments = parseInt(commentsMatch[1].replace(/,/g, ''), 10) || 0;
    }
    
    // Extract username - pattern: "likes, comments - username on"
    const usernameMatch = description.match(/-\s+([a-zA-Z0-9_.]+)\s+on\s/);
    if (usernameMatch) {
        result.username = usernameMatch[1];
    }
    
    // Extract date - pattern: "on Month Day, Year"
    const dateMatch = description.match(/on\s+([A-Za-z]+\s+\d+,\s+\d{4})/);
    if (dateMatch) {
        result.date = dateMatch[1];
    }
    
    // Extract caption - everything after ":"
    const captionMatch = description.match(/:\s*(.+)/);
    if (captionMatch) {
        result.caption = captionMatch[1].trim();
    }
    
    return result;
}

/**
 * Scrape metadata dari Instagram page via OG meta tags
 * @param {string} url 
 * @returns {Promise<object>}
 */
async function scrapeMetadata(url) {
    try {
        const response = await axios.get(url, {
            params: { __a: '1', __d: '1' },
            headers: {
                'User-Agent': USER_AGENT,
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9',
            },
            timeout: 15000,
            maxRedirects: 5,
        });
        
        const html = response.data;
        const $ = cheerio.load(html);
        
        // Extract OG meta tags
        const ogTitle = $('meta[property="og:title"]').attr('content') || null;
        const ogDescription = $('meta[property="og:description"]').attr('content') || null;
        const ogImage = $('meta[property="og:image"]').attr('content') || null;
        const ogUrl = $('meta[property="og:url"]').attr('content') || null;
        const ogType = $('meta[property="og:type"]').attr('content') || null;
        const metaDescription = $('meta[name="description"]').attr('content') || null;
        
        // Parse description untuk metadata terstruktur
        const parsed = parseOgDescription(ogDescription || metaDescription || '');
        
        // Extract username dari og:url jika tidak ada dari description
        let username = parsed.username;
        if (!username && ogUrl) {
            const userMatch = ogUrl.match(/instagram\.com\/([a-zA-Z0-9_.]+)/);
            if (userMatch) username = userMatch[1];
        }
        
        // Extract caption dari og:title jika tidak ada dari description
        let caption = parsed.caption;
        if (!caption && ogTitle) {
            // Format: "Username on Instagram: "caption""
            const titleCaptionMatch = ogTitle.match(/on Instagram:\s*(.+)/);
            if (titleCaptionMatch) {
                caption = titleCaptionMatch[1].trim();
                // Remove surrounding quotes if any
                caption = caption.replace(/^["']|["']$/g, '').trim();
            }
        }
        
        return {
            shortcode: extractShortcode(ogUrl || url),
            url: ogUrl || url,
            title: ogTitle || null,
            caption: caption || null,
            description: ogDescription || metaDescription || null,
            username: username || null,
            likes: parsed.likes || null,
            comments: parsed.comments || null,
            date: parsed.date || null,
            thumbnail: ogImage || null,
            media_type: ogType || null,
        };
    } catch (error) {
        throw new Error(`Gagal mengambil metadata Instagram: ${error.message}`);
    }
}

/**
 * Mendapatkan link download menggunakan VDFRDownloader
 * @param {string} url 
 * @returns {Promise<string|null>}
 */
async function getDownloadLink(url) {
    try {
        const downloader = new VDFRDownloader();
        const downloadUrl = await downloader.getDownloadLink(url);
        return downloadUrl;
    } catch (error) {
        return null;
    }
}

/**
 * Main function: scrape Instagram post dengan metadata lengkap
 * @param {string} url - URL Instagram
 * @returns {Promise<object>}
 */
async function scrapeInstagram(url) {
    if (!url) {
        throw new Error("Parameter 'url' wajib diisi.");
    }

    if (!url.includes('instagram.com')) {
        throw new Error('URL harus dari domain instagram.com');
    }

    // Ambil metadata dari OG tags
    const metadata = await scrapeMetadata(url);
    
    // Ambil link download
    const downloadUrl = await getDownloadLink(url);

    // Bangun result
    return {
        success: true,
        author: 'PuruBoy',
        result: {
            shortcode: metadata.shortcode,
            url: metadata.url,
            caption: metadata.caption || null,
            author: {
                username: metadata.username || null,
                profile_url: metadata.username ? `https://www.instagram.com/${metadata.username}/` : null,
            },
            stats: {
                likes: metadata.likes,
                comments: metadata.comments,
                date: metadata.date,
            },
            thumbnail: metadata.thumbnail || null,
            media_type: metadata.media_type || null,
            download: downloadUrl || null,
            provider: {
                name: 'Instagram',
                url: 'https://www.instagram.com',
            },
        }
    };
}

module.exports = { scrapeInstagram, extractShortcode };

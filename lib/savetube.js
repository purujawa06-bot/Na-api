const axios = require('axios');
const crypto = require('crypto');

const MASTER_KEY_HEX = 'C5D58EF67A7584E4A29F6C35BBC4EB12';

// Fallback CDNs if random-cdn API fails
const FALLBACK_CDNS = [
    'media.savetube.vip',
    'cdn1.savetube.vip',
    'cdn2.savetube.vip',
    'cdn3.savetube.vip'
];

// User-Agent rotation to avoid being blocked
const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:127.0) Gecko/20100101 Firefox/127.0',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:127.0) Gecko/20100101 Firefox/127.0',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0'
];

/**
 * Generate random fake IP address
 */
function getRandomIP() {
    return `${Math.floor(Math.random() * 200) + 1}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 254) + 1}`;
}

/**
 * Build headers with fake IP and random User-Agent
 */
function buildHeaders() {
    const fakeIP = getRandomIP();
    const ua = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
    return {
        'Content-Type': 'application/json',
        'Origin': 'https://ytmp4.co.za',
        'Referer': 'https://ytmp4.co.za/',
        'User-Agent': ua,
        'X-Forwarded-For': fakeIP,
        'X-Real-IP': fakeIP,
        'Client-IP': fakeIP,
        'X-Forwarded-Host': 'ytmp4.co.za',
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
        'Sec-Fetch-Site': 'cross-site',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Dest': 'empty',
        'Sec-Ch-Ua': '"Not/A)Brand";v="99", "Google Chrome";v="126", "Chromium";v="126"',
        'Sec-Ch-Ua-Mobile': '?0',
        'Sec-Ch-Ua-Platform': '"Windows"'
    };
}

/**
 * Decrypts Savetube API response (AES-128-CBC)
 */
function decryptPayload(encryptedBase64) {
    const dataBuffer = Buffer.from(encryptedBase64, 'base64');
    const iv = dataBuffer.slice(0, 16);
    const ciphertext = dataBuffer.slice(16);
    const key = Buffer.from(MASTER_KEY_HEX, 'hex');
    const decipher = crypto.createDecipheriv('aes-128-cbc', key, iv);
    let decrypted = decipher.update(ciphertext, 'binary', 'utf8');
    decrypted += decipher.final('utf8');
    return JSON.parse(decrypted);
}

/**
 * Sleep utility for retry delay
 */
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const savetube = {
    /**
     * Get active CDN node with retry
     */
    getCDN: async (retries = 1) => {
        for (let attempt = 0; attempt <= retries; attempt++) {
            try {
                const res = await axios.get('https://media.savetube.vip/api/random-cdn', {
                    headers: buildHeaders(),
                    timeout: 10000
                });
                if (res.data && res.data.cdn) {
                    return res.data.cdn;
                }
            } catch (err) {
                console.error('[Savetube] getCDN attempt ' + (attempt + 1) + ' failed:', err.message);
                if (attempt < retries) {
                    await sleep(500 * (attempt + 1));
                }
            }
        }
        // Fallback to random from fallback list
        const fallback = FALLBACK_CDNS[Math.floor(Math.random() * FALLBACK_CDNS.length)];
        console.warn('[Savetube] Using fallback CDN: ' + fallback);
        return fallback;
    },

    /**
     * Get Video/Audio Info with retry + fake IP
     */
    getInfo: async (url, retries = 1) => {
        let lastError = null;
        for (let attempt = 0; attempt <= retries; attempt++) {
            const cdn = await savetube.getCDN();
            try {
                const res = await axios.post('https://' + cdn + '/v2/info', { url }, {
                    headers: buildHeaders(),
                    timeout: 15000
                });

                if (!res.data.status) {
                    throw new Error(res.data.message || 'Failed to fetch info');
                }
                
                const decrypted = decryptPayload(res.data.data);
                return {
                    cdn: cdn,
                    ...decrypted
                };
            } catch (err) {
                lastError = err;
                console.error('[Savetube] getInfo attempt ' + (attempt + 1) + ' (CDN: ' + cdn + ') failed:', err.message);
                if (attempt < retries) {
                    await sleep(1000 * (attempt + 1));
                }
            }
        }
        throw lastError || new Error('Failed to fetch video info after retries');
    },

    /**
     * Generate final download link with retry + fake IP
     */
    getDownload: async (cdn, key, quality, type = 'video', retries = 1) => {
        let lastError = null;
        const cdns = [cdn, ...FALLBACK_CDNS.filter(c => c !== cdn)];
        
        for (let attempt = 0; attempt <= retries; attempt++) {
            const targetCdn = attempt === 0 ? cdn : cdns[Math.min(attempt - 1, cdns.length - 1)];
            try {
                const res = await axios.post('https://' + targetCdn + '/download', {
                    downloadType: type,
                    quality: quality,
                    key: key
                }, {
                    headers: buildHeaders(),
                    timeout: 15000
                });

                if (!res.data.status) {
                    throw new Error(res.data.message || 'Failed to generate link');
                }
                return res.data.data;
            } catch (err) {
                lastError = err;
                console.error('[Savetube] getDownload attempt ' + (attempt + 1) + ' (CDN: ' + targetCdn + ') failed:', err.message);
                if (attempt < retries) {
                    await sleep(1000 * (attempt + 1));
                }
            }
        }
        throw lastError || new Error('Failed to generate download link after retries');
    }
};

module.exports = savetube;

const axios = require('axios');
const { URLSearchParams } = require('url');

/**
 * KONFIGURASI DAN HELPER
 */
const CONFIG = {
    baseUrl: 'https://data.toolbaz.com',
    origin: 'https://toolbaz.com',
    referer: 'https://toolbaz.com/',
    userAgent: 'Mozilla/5.0 (Linux; Android 10; RMX2185 Build/QP1A.190711.020) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.7444.171 Mobile Safari/537.36',
    model: 'toolbaz-v4.5-fast',
    language: 'id-ID',
    timezone: 'Asia/Jakarta',
    platform: 'Linux armv8l',
    screenWidth: 360,
    screenHeight: 800,
    colorDepth: 24,
    hardwareConcurrency: 8
};

// Random String Generator
const gRS = (length) => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
};

// Instance Axios
const client = axios.create({
    baseURL: CONFIG.baseUrl,
    headers: {
        'Host': 'data.toolbaz.com',
        'User-Agent': CONFIG.userAgent,
        'Accept': '*/*',
        'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
        'Origin': CONFIG.origin,
        'Referer': CONFIG.referer,
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest'
    },
    timeout: 15000
});

// Cache for tdf (time difference) value
let cachedTdf = null;
let tdfExpiry = 0;
let sessionId = gRS(36);

// Initialize: get server time offset and session
async function ensureInitialized() {
    const now = Math.floor(Date.now() / 1000);
    
    // Get fresh tdf if expired or not set
    if (cachedTdf === null || now > tdfExpiry) {
        try {
            const infoResponse = await client.post('/info.php', 
                new URLSearchParams({
                    'v': '1',
                    '_v': 'j101',
                    'a': '1786349895',
                    't': 'pageview',
                    '_s': '1'
                })
            );
            
            if (infoResponse.data && infoResponse.data.t) {
                const serverTime = infoResponse.data.t;
                cachedTdf = String(serverTime - now);
            } else {
                cachedTdf = '0';
            }
        } catch (e) {
            cachedTdf = '0';
        }
        // Cache for 5 minutes
        tdfExpiry = now + 300;
    }
    
    // Rotate session ID occasionally
    if (sessionId.length < 10) {
        sessionId = gRS(36);
    }
}

/**
 * Generate Client Token - Match frontend's xA1pY() exactly
 */
async function generateClientToken() {
    await ensureInitialized();
    
    const bR6wF = {
        nV5kP: CONFIG.userAgent,
        lQ9jX: CONFIG.language,
        sD2zR: `${CONFIG.screenWidth}x${CONFIG.screenHeight}`,
        tY4hL: CONFIG.timezone,
        pL8mC: CONFIG.platform,
        cQ3vD: CONFIG.colorDepth,
        hK7jN: CONFIG.hardwareConcurrency
    };

    const uT4bX = {
        mM9wZ: [],
        kP8jY: []
    };

    const payloadObj = {
        bR6wF,
        uT4bX,
        tuTcS: Math.floor(Date.now() / 1000),
        tDfxy: cachedTdf,
        RtyJt: gRS(36)
    };

    // Match frontend encoding: btoa(unescape(encodeURIComponent(JSON.stringify(payload))))
    const jsonStr = JSON.stringify(payloadObj);
    const encoded = Buffer.from(jsonStr, 'utf-8').toString('base64');
    const prefix = gRS(6);

    return prefix + encoded;
}

/**
 * FUNGSI UTAMA CHAT
 */
async function chatGrok(message) {
    try {
        // Initialize session and get tdf
        await ensureInitialized();
        
        const currentSessionId = sessionId;
        const clientToken = await generateClientToken();

        // Step 1: Request Token
        const tokenParams = new URLSearchParams();
        tokenParams.append('session_id', currentSessionId);
        tokenParams.append('token', clientToken);

        const tokenResponse = await client.post('/token.php', tokenParams);

        if (!tokenResponse.data || !tokenResponse.data.success) {
            throw new Error(`Gagal mendapatkan token: ${JSON.stringify(tokenResponse.data)}`);
        }

        const serverCapcha = tokenResponse.data.token;

        // Step 2: Kirim Pesan
        const chatParams = new URLSearchParams();
        chatParams.append('text', message);
        chatParams.append('capcha', serverCapcha);
        chatParams.append('model', CONFIG.model);
        chatParams.append('session_id', currentSessionId);

        const chatResponse = await client.post('/writing.php', chatParams);

        let cleanText = chatResponse.data;
        if (typeof cleanText === 'string') {
            cleanText = cleanText.replace(/\[model:\s*[^\]]+\]/g, '').trim();
        }

        return cleanText;

    } catch (error) {
        if (error.response) {
            // Include more detail in error for debugging
            const detail = error.response.data ? String(error.response.data).substring(0, 200) : 'no body';
            throw new Error(`Grok API Error: ${error.response.status} - ${detail}`);
        }
        if (error.code === 'ECONNABORTED') {
            throw new Error('Grok API Error: Timeout - server tidak merespon');
        }
        throw new Error(`Grok API Error: ${error.message}`);
    }
}

module.exports = { chatGrok };

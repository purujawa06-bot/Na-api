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

// Maximum prompt length untuk ToolBaz/Grok API
const MAX_PROMPT_LENGTH = 2500;

// Rate Limiter: max 4 request per 60 detik (safe dari limit 5/menit)
const RATE_LIMIT = { maxRequests: 4, windowMs: 60000 };
let requestTimestamps = [];

// Pool User-Agent biar gak keliatan bot
const UA_POOL = [
    'Mozilla/5.0 (Linux; Android 10; RMX2185 Build/QP1A.190711.020) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.7444.171 Mobile Safari/537.36',
    'Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.7444.170 Mobile Safari/537.36',
    'Mozilla/5.0 (Linux; Android 12; Xiaomi 12T Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.7444.168 Mobile Safari/537.36',
    'Mozilla/5.0 (Linux; Android 11; Redmi Note 10S) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.7444.166 Mobile Safari/537.36',
    'Mozilla/5.0 (Linux; Android 14; Pixel 8 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.7444.172 Mobile Safari/537.36',
];

// Random String Generator
const gRS = (length) => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
};

// Generate fake IP random
const fakeIP = () => {
    const octets = [];
    for (let i = 0; i < 4; i++) {
        if (i === 0) {
            octets.push(Math.floor(Math.random() * 200) + 10);
        } else {
            octets.push(Math.floor(Math.random() * 255));
        }
    }
    return octets.join('.');
};

// Rate limiter: cek apakah boleh request
const checkRateLimit = () => {
    const now = Date.now();
    requestTimestamps = requestTimestamps.filter(ts => now - ts < RATE_LIMIT.windowMs);
    
    if (requestTimestamps.length >= RATE_LIMIT.maxRequests) {
        const oldest = requestTimestamps[0];
        const waitMs = RATE_LIMIT.windowMs - (now - oldest);
        throw new Error(`Rate limit lokal: Harap tunggu ${Math.ceil(waitMs / 1000)} detik sebelum request lagi.`);
    }
    
    requestTimestamps.push(now);
};

// Instance Axios
const client = axios.create({
    baseURL: CONFIG.baseUrl,
    timeout: 20000
});

// Headers dinamis per request (dengan fake IP)
const getHeaders = () => {
    const ip = fakeIP();
    return {
        'Host': 'data.toolbaz.com',
        'User-Agent': UA_POOL[Math.floor(Math.random() * UA_POOL.length)],
        'Accept': '*/*',
        'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
        'Origin': CONFIG.origin,
        'Referer': CONFIG.referer,
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest',
        'X-Forwarded-For': ip,
        'X-Real-IP': ip,
        'Client-IP': ip,
        'X-Forwarded-Host': 'data.toolbaz.com',
        'X-Forwarded-Proto': 'https',
    };
};

// Cache for tdf (time difference) value
let cachedTdf = null;
let tdfExpiry = 0;
let sessionId = gRS(36);

// Initialize: get server time offset and session
async function ensureInitialized() {
    const now = Math.floor(Date.now() / 1000);
    
    if (cachedTdf === null || now > tdfExpiry) {
        try {
            const infoResponse = await client.post('/info.php', 
                new URLSearchParams({
                    'v': '1',
                    '_v': 'j101',
                    'a': '1786349895',
                    't': 'pageview',
                    '_s': '1'
                }),
                { headers: getHeaders() }
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
        tdfExpiry = now + 300;
    }
    
    if (sessionId.length < 10) {
        sessionId = gRS(36);
    }
}

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

    const jsonStr = JSON.stringify(payloadObj);
    const encoded = Buffer.from(jsonStr, 'utf-8').toString('base64');
    const prefix = gRS(6);

    return prefix + encoded;
}

async function chatGrok(message) {
    try {
        if (!message || typeof message !== 'string') {
            throw new Error('Parameter "message" harus berupa string yang valid.');
        }
        
        if (message.length > MAX_PROMPT_LENGTH) {
            message = message.substring(0, MAX_PROMPT_LENGTH) + '\n\n[...pesan dipotong karena terlalu panjang]';
        }
        
        checkRateLimit();
        
        await ensureInitialized();
        
        const currentSessionId = sessionId;
        const clientToken = await generateClientToken();
        const headers = getHeaders();

        const tokenParams = new URLSearchParams();
        tokenParams.append('session_id', currentSessionId);
        tokenParams.append('token', clientToken);

        const tokenResponse = await client.post('/token.php', tokenParams, { headers });

        if (!tokenResponse.data || !tokenResponse.data.success) {
            throw new Error(`Gagal mendapatkan token: ${JSON.stringify(tokenResponse.data)}`);
        }

        const serverCapcha = tokenResponse.data.token;

        const chatParams = new URLSearchParams();
        chatParams.append('text', message);
        chatParams.append('capcha', serverCapcha);
        chatParams.append('model', CONFIG.model);
        chatParams.append('session_id', currentSessionId);

        const chatResponse = await client.post('/writing.php', chatParams, { headers });

        let cleanText = chatResponse.data;
        if (typeof cleanText === 'string') {
            cleanText = cleanText.replace(/\[model:\s*[^\]]+\]/g, '').trim();
        }

        return cleanText;

    } catch (error) {
        if (error.response) {
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

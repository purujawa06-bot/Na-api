const axios = require('axios');
const qs = require('qs');
const { wrapper } = require('axios-cookiejar-support');
const { CookieJar } = require('tough-cookie');
const cheerio = require('cheerio');

/**
 * Gemini AI V2 - BatchExecute Method
 * Automated Cookie Handling & Firebase Persistence
 * + Auto-extract 'at' token from Gemini homepage
 */

const FIREBASE_URL = 'https://puru-tools-default-rtdb.firebaseio.com/cookieGeminiV2.json';

async function syncFirebase(method = 'GET', data = null) {
    try {
        if (method === 'GET') {
            const res = await axios.get(FIREBASE_URL);
            return res.data || null;
        } else {
            await axios.put(FIREBASE_URL, {
                cookies: data?.cookies || null,
                at_token: data?.at_token || null,
                last_updated: new Date().toISOString()
            });
        }
    } catch (err) {
        // Silent error for database sync
    }
}

/**
 * Extract 'at' token (SNlM0e) from Gemini homepage HTML.
 * Token ini diperlukan untuk autentikasi request batchexecute.
 * Format di HTML: "SNlM0e":"<TOKEN>" atau "at":"<TOKEN>"
 */
function extractAtToken(html) {
    // Try multiple patterns to find the token
    const patterns = [
        /"SNlM0e"\s*:\s*"([^"]+)"/,
        /"at"\s*:\s*"([^"]+)"/,
        /"cfb2h"\s*:\s*"([^"]+)"/
    ];
    
    for (const pattern of patterns) {
        const match = html.match(pattern);
        if (match && match[1] && match[1].length > 10) {
            return match[1];
        }
    }
    
    // Fallback: try to parse with cheerio
    try {
        const $ = cheerio.load(html);
        // Check script tags for the data
        const scripts = $('script').text();
        for (const pattern of patterns) {
            const match = scripts.match(pattern);
            if (match && match[1] && match[1].length > 10) {
                return match[1];
            }
        }
    } catch (e) {
        // silent
    }
    
    return null;
}

/**
 * Fetch a fresh 'at' token from Gemini homepage
 */
async function fetchAtToken(client) {
    try {
        const resp = await client.get('https://gemini.google.com/', {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
            }
        });
        
        const html = typeof resp.data === 'string' ? resp.data : JSON.stringify(resp.data);
        const token = extractAtToken(html);
        
        return token;
    } catch (err) {
        throw new Error(`Gagal fetch at token: ${err.message}`);
    }
}

// Peta gRPC error code yang dikembalikan Gemini di index [5]
const GRPC_ERROR_CODES = {
    1:  'CANCELLED',
    2:  'UNKNOWN',
    3:  'INVALID_ARGUMENT',
    4:  'DEADLINE_EXCEEDED',
    5:  'NOT_FOUND',
    6:  'ALREADY_EXISTS',
    7:  'PERMISSION_DENIED',
    8:  'RESOURCE_EXHAUSTED',
    9:  'FAILED_PRECONDITION',
    10: 'ABORTED',
    13: 'INTERNAL — Session tidak valid atau cookie expired, coba refresh cookie',
    14: 'UNAVAILABLE',
    16: 'UNAUTHENTICATED — Perlu login ulang ke Gemini',
};

/**
 * Cari entry "q4uTj" secara rekursif di dalam array yang bisa flat maupun nested.
 * Menangani format respons Gemini:
 *   Format 1 (flat):    [["wrb.fr","q4uTj",DATA,...], ["di",...]]
 *   Format 2 (nested):  [[["wrb.fr","q4uTj",DATA,...]], ...] (chunked streaming)
 *   Format 3 (error):   ["wrb.fr","q4uTj",null,null,null,[CODE],"generic"]
 *
 * @returns {string} innerDataString jika sukses
 * @throws  {Error}  jika ditemukan gRPC error code
 */
function findQ4uTjEntry(arr, depth = 0) {
    if (depth > 4 || !Array.isArray(arr)) return null;

    // Cek apakah arr ini adalah entry q4uTj
    if (typeof arr[1] === 'string' && arr[1] === 'q4uTj') {
        // Format 3: data null tapi ada error code di index [5]
        if (arr[2] == null && Array.isArray(arr[5])) {
            const code = arr[5][0];
            const desc = GRPC_ERROR_CODES[code] || `UNKNOWN_CODE_${code}`;
            throw new Error(`Gemini gRPC Error ${code}: ${desc}`);
        }
        // Format normal: data ada di index [2]
        if (arr[2] != null) return arr[2];
    }

    // Cari secara rekursif di semua elemen yang berupa array
    for (const item of arr) {
        if (Array.isArray(item)) {
            const found = findQ4uTjEntry(item, depth + 1);
            if (found != null) return found;
        }
    }
    return null;
}

/**
 * Ekstrak teks balasan dari raw response Gemini batchexecute.
 * Menggunakan state-machine (Lexer) untuk mengabaikan bracket di dalam string teks.
 */
function extractReply(rawData) {
    if (typeof rawData !== 'string') rawData = JSON.stringify(rawData);

    // 1. Hapus prefix anti-XSS Google: )]}'
    const stripped = rawData.replace(/^\)\]\}'\s*/m, '').trim();

    // 2. Hapus baris yang hanya berisi angka hex/desimal (artefak HTTP chunked encoding)
    const cleaned = stripped
        .split('\n')
        .filter(line => !/^\s*[0-9a-fA-F]+\s*$/.test(line.trim()))
        .join('\n');

    // 3. Ekstrak blok JSON dengan aman (State Machine)
    // Mencegah error jika ada karakter '[' atau ']' di dalam teks balasan Gemini
    const jsonBlocks = [];
    let depth = 0;
    let start = -1;
    let inString = false;
    let isEscape = false;

    for (let i = 0; i < cleaned.length; i++) {
        const ch = cleaned[i];

        if (!inString) {
            // Jika kita TIDAK sedang di dalam teks string (")
            if (ch === '"') {
                inString = true;
            } else if (ch === '[') {
                if (depth === 0) start = i;
                depth++;
            } else if (ch === ']') {
                depth--;
                if (depth === 0 && start !== -1) {
                    jsonBlocks.push(cleaned.slice(start, i + 1));
                    start = -1;
                }
            }
        } else {
            // Jika kita SEDANG berada di dalam string (")
            if (isEscape) {
                isEscape = false; // Lewati karakter yang di-escape (misal \")
            } else if (ch === '\\') {
                isEscape = true;
            } else if (ch === '"') {
                inString = false; // Keluar dari mode string
            }
        }
    }

    // 4. Cari entry q4uTj secara rekursif
    let innerDataString = null;
    for (const block of jsonBlocks) {
        let parsed;
        try { 
            parsed = JSON.parse(block); 
        } catch (e) { 
            continue; 
        }
        
        const found = findQ4uTjEntry(parsed); // bisa throw Error gRPC
        if (found != null) { 
            innerDataString = found; 
            break; 
        }
    }

    if (!innerDataString) {
        throw new Error('q4uTj entry tidak ditemukan — format respons tidak dikenali atau JSON terpotong');
    }

    // 5. Parse objek dari innerDataString yang seringkali double/triple stringified
    try {
        let parsed = innerDataString;
        
        // Loop un-stringify untuk jaga-jaga nesting JSON yang sangat berlapis
        while (typeof parsed === 'string') {
            try { 
                parsed = JSON.parse(parsed); 
            } catch(e) { 
                break; 
            }
        }
        
        // Jika hasil parse berupa array yang dibungkus array lain
        if (Array.isArray(parsed)) {
            parsed = parsed[0];
            while (typeof parsed === 'string') {
                try { 
                    parsed = JSON.parse(parsed); 
                } catch(e) { 
                    break; 
                }
            }
        }

        const text = parsed?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) return text;
    } catch (_) { /* lanjut fallback */ }

    // 6. Fallback regex jika JSON parsing gagal menemukan properti 'candidates'
    const m = innerDataString.match(/"text"\s*:\s*"((?:[^"\\]|\\.)*)"/);
    if (m) {
        return m[1]
            .replace(/\\n/g, '\n')
            .replace(/\\"/g, '"')
            .replace(/\\\\/g, '\\');
    }

    throw new Error('Semua metode ekstraksi gagal menemukan teks balasan');
}

async function chat(promptText, retryCount = 0) {
    const jar = new CookieJar();
    const client = wrapper(axios.create({
        jar,
        withCredentials: true,
        maxRedirects: 10
    }));

    // 1. Load existing cookies & at_token from Firebase
    const savedData = await syncFirebase('GET');
    let atToken = null;
    
    if (savedData) {
        // Load cookies
        if (savedData.cookies) {
            try {
                const parsed = JSON.parse(savedData.cookies);
                if (Array.isArray(parsed)) {
                    parsed.forEach(cookieStr => {
                        jar.setCookieSync(cookieStr, 'https://gemini.google.com');
                    });
                } else {
                    jar.setCookieSync(savedData.cookies, 'https://gemini.google.com');
                }
            } catch (e) {
                jar.setCookieSync(savedData.cookies, 'https://gemini.google.com');
            }
        }
        
        // Load at token
        if (savedData.at_token && retryCount === 0) {
            atToken = savedData.at_token;
        }
    }

    // 2. If no at token (or retrying after expiration), fetch fresh from Gemini homepage
    if (!atToken) {
        atToken = await fetchAtToken(client);
        if (!atToken) {
            throw new Error('Gagal mendapatkan at token dari halaman Gemini. Periksa network atau cookie.');
        }
    }

    // 3. Construct RPC Payload
    const contents = {
        contents: [
            {
                role: 'user',
                parts: [{ text: promptText }]
            }
        ]
    };

    const rpcData = [
        null,
        JSON.stringify(contents),
        1,
        'caea8d35955a'
    ];

    const fReq = [
        [
            [
                'q4uTj',
                JSON.stringify(rpcData),
                null,
                'generic'
            ]
        ]
    ];

    const payload = qs.stringify({
        'f.req': JSON.stringify(fReq),
        'at': atToken
    });

    try {
        // 4. Perform Request
        const response = await client.post(
            'https://gemini.google.com/_/BardChatUi/data/batchexecute',
            payload,
            {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
                    'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
                    'X-Same-Domain': '1',
                    'Origin': 'https://gemini.google.com',
                    'Referer': 'https://gemini.google.com/',
                    'Accept': '*/*'
                }
            }
        );

        // 5. Persistence: Capture and save new cookies + at token
        const cookiesToSave = JSON.stringify(
            jar.getCookiesSync('https://gemini.google.com').map(c => c.toString())
        );
        await syncFirebase('PUT', {
            cookies: cookiesToSave,
            at_token: atToken
        });

        // 6. Extract reply using Lexer parser
        const rawData = response.data;
        const rawStr = typeof rawData === 'string' ? rawData : JSON.stringify(rawData);

        try {
            const reply = extractReply(rawData);
            return reply;
        } catch (extractErr) {
            // Include raw response for debugging new formats
            throw new Error(
                `${extractErr.message}\n\n=== RAW RESPONSE ===\n${rawStr.slice(0, 3000)}`
            );
        }

    } catch (err) {
        // Handle 400 / INVALID_ARGUMENT — refresh token & retry once
        const isInvalidArg = err.message?.includes('INVALID_ARGUMENT');
        const is400 = err.response?.status === 400;
        
        if ((isInvalidArg || is400) && retryCount < 1) {
            // Force fresh token fetch on retry
            return chat(promptText, retryCount + 1);
        }
        
        if (err.response?.status === 400) {
            throw new Error('Gemini Error 400: Payload rejected. Session might be invalid.');
        }
        throw new Error(`Gagal menghubungi Gemini V2: ${err.message}`);
    }
}

module.exports = { chat };

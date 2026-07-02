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
        } else if (method === 'PUT' && data) {
            // Baca data existing dulu, lalu merge — jangan overwrite valid data dengan null
            let existing = {};
            try {
                const existingRes = await axios.get(FIREBASE_URL);
                existing = existingRes.data || {};
            } catch (_) {}
            
            // Hanya update field yang disediakan, sisanya pertahankan dari existing
            const updateData = {
                cookies: data.cookies !== undefined ? data.cookies : (existing.cookies || null),
                at_token: data.at_token !== undefined ? data.at_token : (existing.at_token || null),
                last_updated: new Date().toISOString()
            };
            
            await axios.put(FIREBASE_URL, updateData);
        }
    } catch (err) {
        // Silent error for database sync
    }
}

/**
 * Validasi apakah string看起來 seperti SNlM0e token asli (bukan boq_ version string).
 * Token SNlM0e asli biasanya panjang (50-300 chars), alfanumerik, bisa mengandung / + _ - .
 * BOQ version string: boq_assistant-bard-web-server_YYYYMMDD.N_p0
 * 
 * @param {string} token - String token yang akan divalidasi
 * @returns {boolean} true jika token valid
 */
function isValidAtToken(token) {
    if (!token || typeof token !== 'string') return false;
    
    // Reject boq_ version strings (bukan token auth)
    if (/^boq_/i.test(token)) return false;
    
    // Reject strings that are too short (< 30 chars)
    if (token.length < 30) return false;
    
    // Reject dates/version patterns
    if (/_\d{8}\./.test(token)) return false;
    
    // Token asli biasanya tidak mengandung spasi, newline
    if (/\s/.test(token)) return false;
    
    // Pastikan terdiri dari karakter yang wajar untuk token
    if (!/^[a-zA-Z0-9_\/\+\-\.=]+$/.test(token)) return false;
    
    return true;
}

/**
 * Extract 'at' token (SNlM0e) from Gemini homepage HTML.
 * Token ini diperlukan untuk autentikasi request batchexecute.
 * 
 * SNlM0e adalah token CSRF yang ditemukan di:
 * - window.WIZ_global_data.SNlM0e
 * - window.WIZ_global_data.d6Ul6d
 * - Data dalam script tag __INITIAL_STATE__
 * 
 * Format token: "4/HoRf..." (base64-like) — biasanya 100-300 karakter
 */
function extractAtToken(html) {
    if (!html || typeof html !== 'string') return null;
    
    // === PRIORITAS 1: Cari SNlM0e di WIZ_global_data (pattern paling umum) ===
    // window.WIZ_global_data = { "SNlM0e":"TOKEN", ... }
    // atau "SNlM0e":"TOKEN" dalam bl manapun di HTML
    const snlmPatterns = [
        // Format di WIZ_global_data: "SNlM0e":"<token>"
        /["']SNlM0e["']\s*[:=]\s*["']([^"']+)["']/,
        // Format di __INITIAL_STATE__ atau data lain
        /SNlM0e["']?\s*[:=]\s*["']([a-zA-Z0-9_\/+\-\.=]{50,})["']/,
        // Format standalone
        /"SNlM0e"\s*:\s*"([a-zA-Z0-9_\/+\-\.=]{50,})"/,
    ];
    
    for (const pattern of snlmPatterns) {
        const match = html.match(pattern);
        if (match && match[1] && isValidAtToken(match[1])) {
            return match[1];
        }
    }
    
    // === PRIORITAS 2: Cari "at" key dengan token yang valid (bukan boq_) ===
    const atPatterns = [
        // "at":"<long_token>" — pastikan token panjang (bukan boq_)
        /"at"\s*:\s*"((?!boq_)[a-zA-Z0-9_\/+\-\.=]{50,})"/,
        // "at":"<token>" lalu validasi
        /"at"\s*:\s*"([^"]{50,})"/,
    ];
    
    for (const pattern of atPatterns) {
        const match = html.match(pattern);
        if (match && match[1] && isValidAtToken(match[1])) {
            return match[1];
        }
    }
    
    // === PRIORITAS 3: Cari key lain yang mungkin berisi token ===
    const otherKeys = [
        /"cfb2h"\s*:\s*"([a-zA-Z0-9_\/+\-\.=]{50,})"/,
        /"d6Ul6d"\s*:\s*"([a-zA-Z0-9_\/+\-\.=]{50,})"/,
    ];
    
    for (const pattern of otherKeys) {
        const match = html.match(pattern);
        if (match && match[1] && isValidAtToken(match[1])) {
            return match[1];
        }
    }
    
    // === PRIORITAS 4: Cari di window.WIZ_globalata dengan parsing lebih lanjut ===
    try {
        const wizMatch = html.match(/window\[?["']WIZ_global_data["']?\]?\s*=\s*(\{.+?\});/);
        if (wizMatch) {
            let wizData;
            try {
                wizData = JSON.parse(wizMatch[1]);
            } catch (e) {
                // Coba dengan eval-safe parse
                wizData = JSON.parse(wizMatch[1].replace(/undefined/g, 'null').replace(/new Date\([^)]*\)/g, 'null'));
            }
            
            if (wizData) {
                // Coba SNlM0e
                const snlm = wizData.SNlM0e || wizData['SNlM0e'];
                if (snlm && isValidAtToken(snlm)) return snlm;
                
                // Coba alternatif key
                const altKeys = ['cfb2h', 'd6Ul6d', 'at'];
                for (const key of altKeys) {
                    const val = wizData[key];
                    if (val && isValidAtToken(val)) return val;
                }
            }
        }
    } catch (e) {
        // silent
    }
    
    // === PRIORITAS 5: Fallback — parse script tags dengan cheerio ===
    try {
        const $ = cheerio.load(html);
        const allScripts = $('script').text();
        
        // Cari di semua script content
        const allPatterns = [
            /"SNlM0e"\s*:\s*"([a-zA-Z0-9_\/+\-\.=]{50,})"/,
            /"at"\s*:\s*"((?!boq_)[a-zA-Z0-9_\/+\-\.=]{50,})"/,
            /SNlM0e["']?\s*[:=]\s*["']([a-zA-Z0-9_\/+\-\.=]{50,})["']/,
        ];
        
        for (const pattern of allPatterns) {
            const match = allScripts.match(pattern);
            if (match && isValidAtToken(match[1])) {
                return match[1];
            }
        }
    } catch (e) {
        // silent
    }
    
    return null;
}

/**
/**
 * Fetch a fresh 'at' token from Gemini homepage or alternative sources.
 * Mencoba beberapa endpoint untuk mendapatkan token.
 * Termasuk fallback ke Google Search/Accounts untuk ekstrak WIZ_global_data.
 */
async function fetchAtToken(client) {
    // Daftar URL + User-Agent yang akan dicoba untuk extract token
    const attempts = [
        // Gemini homepage (desktop)
        { url: 'https://gemini.google.com/', ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36' },
        // Gemini homepage (mobile)
        { url: 'https://gemini.google.com/', ua: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36' },
        // Gemini app
        { url: 'https://gemini.google.com/app', ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36' },
        // Google Search (signed-in users sometimes get WIZ_global_data here)
        { url: 'https://www.google.com/', ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36' },
        // Google Search with specific path
        { url: 'https://www.google.com/webhp?hl=en', ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36' },
        // Accounts Google (sometimes has the token in login flow)
        { url: 'https://accounts.google.com/ServiceLogin?service=gemini', ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36' },
    ];
    
    let errors = [];
    
    for (const attempt of attempts) {
        try {
            const resp = await client.get(attempt.url, {
                headers: {
                    'User-Agent': attempt.ua,
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                    'Accept-Language': 'en-US,en;q=0.9',
                },
                timeout: 10000
            });
            
            const html = typeof resp.data === 'string' ? resp.data : JSON.stringify(resp.data);
            
            // Skip halaman yang terlalu pendek (JS shell, ga ada konten)
            if (html.length < 200) continue;
            
            const token = extractAtToken(html);
            
            if (token) {
                return token;
            }
        } catch (err) {
            errors.push(`${attempt.url}: ${err.message || 'no response'}`);
            continue;
        }
    }
    
    // Fallback: coba request ke batchexecute endpoint tanpa token
    // (kadang Google return token di response header atau error message)
    try {
        const probeResp = await client.post(
            'https://gemini.google.com/_/BardChatUi/data/batchexecute',
            'f.req=%5B%5B%5B%22q4uTj%22%2C%22%5Bnull%2C%5C%22%5C%22%2Cnull%2C%5C%22caea8d35955a%5C%22%5D%22%2Cnull%2C%22generic%22%5D%5D%5D&at=null',
            {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
                    'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
                },
                timeout: 10000
            }
        );
        
        // Coba extract token dari response body
        if (probeResp.data) {
            const body = typeof probeResp.data === 'string' ? probeResp.data : JSON.stringify(probeResp.data);
            const extracted = extractAtToken(body);
            if (extracted) return extracted;
        }
        
        // Cek response headers untuk token
        if (probeResp.headers) {
            const headerStr = JSON.stringify(probeResp.headers);
            const extracted = extractAtToken(headerStr);
            if (extracted) return extracted;
        }
    } catch (err) {
        errors.push(`batchexecute fallback: ${err.message || 'no response'}`);
    }
    
    // Semua gagal — throw error dengan detail
    const errorDetail = errors.join(' | ');
    throw new Error(`Gagal fetch at token dari semua sumber: ${errorDetail || 'tidak ada response sama sekali'}`);
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
                try { jar.setCookieSync(savedData.cookies, 'https://gemini.google.com'); } catch (_) {}
            }
        }
        
        // Load at token — only if it looks valid (bukan boq_ version string)
        if (savedData.at_token && retryCount === 0) {
            if (isValidAtToken(savedData.at_token)) {
                atToken = savedData.at_token;
            } else {
                // Token tidak valid, paksa fetch ulang
                atToken = null;
            }
        }
    }

    // 2. If no at token (or retrying after expiration), fetch fresh from Gemini homepage
    if (!atToken) {
        try {
            atToken = await fetchAtToken(client);
        } catch (fetchErr) {
            // Fallback: coba request tanpa at_token — beberapa endpoint Google masih work
            // dengan cookies aja untuk request tertentu
            // (akan dilempar error 400 kalo emang gak bisa)
        }
        
        if (!atToken) {
            // Fallback terakhir: coba dengan at_token kosong
            // Request mungkin gagal, tapi setidaknya kita coba dulu
            atToken = '';
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

    // RPC data: [null, serializedContents, 1, rpcMethodHash]
    // caea8d35955a = Gemini V2 method hash (perlu diupdate jika Google rotate)
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
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
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
        // Handle 400 / INVALID_ARGUMENT / INVALID_TOKEN — refresh token & retry once
        const isInvalidArg = err.message?.includes('INVALID_ARGUMENT');
        const is400 = err.response?.status === 400;
        const isTokenError = err.message?.includes('at token') || err.message?.includes('SNlM0e') || err.message?.includes('Gagal fetch');
        
        if ((isInvalidArg || is400 || isTokenError) && retryCount < 1) {
            // Retry tanpa hapus Firebase data — cukup paksa refresh token
            return chat(promptText, retryCount + 1);
        }
        
        if (err.response?.status === 400) {
            throw new Error('Gemini Error 400: Payload rejected. Token atau cookie mungkin tidak valid.');
        }
        throw new Error(`Gagal menghubungi Gemini V2: ${err.message}`);
    }
}

module.exports = { chat };

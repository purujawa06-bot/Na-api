const axios = require('axios');
const qs = require('qs');
const { wrapper } = require('axios-cookiejar-support');
const { CookieJar } = require('tough-cookie');

/**
 * Gemini AI V2 - Optimized BatchExecute Method
 * 
 * PERUBAHAN BESAR (2026-07-03):
 * - Tidak lagi membutuhkan token SNlM0e (at token) — endpoint batchexecute 
 *   menerima empty at token (`at=''`) tanpa masalah
 * - Tidak perlu scraping HTML homepage untuk ekstrak token
 * - Response jauh lebih cepat (~2-3 detik vs sebelumnya 10-70 detik)
 * - Cookies bersifat opsional (untuk rate limit yang lebih baik jika ada)
 * - Firebase sync tetap ada untuk caching cookies antar session
 * 
 * Tested: Gemini 3 Flash Preview model
 * Endpoint: https://gemini.google.com/_/BardChatUi/data/batchexecute
 */

const FIREBASE_URL = 'https://puru-tools-default-rtdb.firebaseio.com/cookieGeminiV2.json';
const BATCHEXECUTE_URL = 'https://gemini.google.com/_/BardChatUi/data/batchexecute';
const METHOD_HASH = 'caea8d35955a'; // RPC method identifier untuk Gemini chat

/**
 * Sync data cookies ke Firebase.
 * Cookies bersifat opsional — berguna untuk rate limit yang lebih baik.
 */
async function syncFirebase(method = 'GET', data = null) {
    try {
        if (method === 'GET') {
            const res = await axios.get(FIREBASE_URL, { timeout: 5000 });
            return res.data || null;
        } else if (method === 'PUT' && data) {
            let existing = {};
            try {
                const existingRes = await axios.get(FIREBASE_URL, { timeout: 5000 });
                existing = existingRes.data || {};
            } catch (_) {}
            
            const updateData = {
                cookies: data.cookies !== undefined ? data.cookies : (existing.cookies || null),
                at_token: data.at_token !== undefined ? data.at_token : (existing.at_token || null),
                last_updated: new Date().toISOString()
            };
            
            await axios.put(FIREBASE_URL, updateData, { timeout: 5000 });
        }
    } catch (err) {
        // Silent — Firebase opsional
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
 * Cari entry "q4uTj" secara rekursif di dalam array.
 * Menangani format respons Gemini yang flat maupun nested (chunked streaming).
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
    let jsonBlocks = [];
    let depth = 0;
    let start = -1;
    let inString = false;
    let isEscape = false;

    for (let i = 0; i < cleaned.length; i++) {
        const ch = cleaned[i];

        if (!inString) {
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
            if (isEscape) {
                isEscape = false;
            } else if (ch === '\\') {
                isEscape = true;
            } else if (ch === '"') {
                inString = false;
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
        
        const found = findQ4uTjEntry(parsed);
        if (found != null) { 
            innerDataString = found; 
            break; 
        }
    }

    if (!innerDataString) {
        throw new Error('q4uTj entry tidak ditemukan — format respons tidak dikenali atau JSON terpotong');
    }

    // 5. Parse objek dari innerDataString
    try {
        let parsed = innerDataString;
        
        while (typeof parsed === 'string') {
            try { 
                parsed = JSON.parse(parsed); 
            } catch(e) { 
                break; 
            }
        }
        
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
    } catch (_) {}

    // 6. Fallback regex
    const m = innerDataString.match(/"text"\s*:\s*"((?:[^"\\]|\\.)*)"/);
    if (m) {
        return m[1]
            .replace(/\\n/g, '\n')
            .replace(/\\"/g, '"')
            .replace(/\\\\/g, '\\');
    }

    throw new Error('Semua metode ekstraksi gagal menemukan teks balasan');
}

/**
 * Chat dengan Gemini V2 via batchexecute endpoint.
 * 
 * OPTIMASI 2026-07-03:
 * - Tidak perlu token SNlM0e (at token) — endpoint menerima empty string
 * - Tidak perlu scraping HTML homepage — langsung POST ke batchexecute
 * - Response time ~2-3 detik (dari sebelumnya 10-70 detik)
 * - Cookies opsional — disimpan di Firebase untuk rate limit yang lebih baik
 * 
 * @param {string} promptText - Pertanyaan untuk Gemini
 * @param {number} retryCount - Internal: counter retry
 * @returns {Promise<string>} Teks balasan dari Gemini
 */
async function chat(promptText, retryCount = 0) {
    // Setup cookie jar untuk menyimpan cookies session
    const jar = new CookieJar();
    const client = wrapper(axios.create({
        jar,
        withCredentials: true,
        maxRedirects: 5
    }));

    // Load cookies dari Firebase (jika ada) — opsional
    const savedData = await syncFirebase('GET');
    if (savedData?.cookies) {
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

    // Construct RPC Payload
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
        METHOD_HASH
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
        'at': '' // SNlM0e token TIDAK diperlukan — empty string works
    });

    try {
        // Kirim request ke batchexecute
        const response = await client.post(
            BATCHEXECUTE_URL,
            payload,
            {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
                    'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
                    'X-Same-Domain': '1',
                    'Origin': 'https://gemini.google.com',
                    'Referer': 'https://gemini.google.com/',
                    'Accept': '*/*'
                },
                timeout: 30000
            }
        );

        // Simpan cookies untuk keperluan session berikutnya
        try {
            const cookiesToSave = JSON.stringify(
                jar.getCookiesSync('https://gemini.google.com').map(c => c.toString())
            );
            if (cookiesToSave && cookiesToSave.length > 10) {
                await syncFirebase('PUT', { cookies: cookiesToSave });
            }
        } catch (_) {}

        // Ekstrak balasan
        const rawData = response.data;
        return extractReply(rawData);

    } catch (err) {
        // Retry 1x jika gagal
        if (retryCount < 1) {
            // Tunggu sebentar sebelum retry
            await new Promise(r => setTimeout(r, 1000));
            return chat(promptText, retryCount + 1);
        }

        // Jika ada response dari server, sertakan detail error
        if (err.response) {
            const status = err.response.status;
            if (status === 400) {
                throw new Error('Gemini V2: Payload ditolak (400). Mungkin format RPC sudah berubah.');
            } else if (status === 429) {
                throw new Error('Gemini V2: Terlalu banyak request (429). Silakan coba lagi nanti.');
            } else if (status === 503) {
                throw new Error('Gemini V2: Layanan sedang sibuk (503). Silakan coba lagi nanti.');
            }
            throw new Error(`Gemini V2 error (${status}): ${err.message}`);
        }

        throw new Error(`Gemini V2: ${err.message || 'Gagal terhubung ke server Gemini'}`);
    }
}

module.exports = { chat };

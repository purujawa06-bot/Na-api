const axios = require('axios');
const qs = require('qs');
const { wrapper } = require('axios-cookiejar-support');
const { CookieJar } = require('tough-cookie');

/**
 * Gemini AI V3 — Hybrid Engine (V2 + V1 Fallback)
 * 
 * Strategi:
 * 1. Coba V2 (batchexecute — cepat, tanpa cookie/token)
 * 2. Jika gagal → fallback ke V1 (StreamGenerate — butuh cookie & token)
 * 3. Jika gagal lagi → coba V2 sekali lagi
 * Maksimal 3x total percobaan.
 * 
 * Response mengembalikan data ASLI dari Gemini API (raw JSON).
 */

// ─── Constants ───────────────────────────────────────────────────────────────

const FIREBASE_V2_URL = 'https://puru-tools-default-rtdb.firebaseio.com/cookieGeminiV2.json';
const FIREBASE_V1_URL = 'https://puru-tools-default-rtdb.firebaseio.com/sessions/google.json';

const BATCHEXECUTE_URL = 'https://gemini.google.com/_/BardChatUi/data/batchexecute';
const STREAMGENERATE_URL = 'https://gemini.google.com/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate';
const METHOD_HASH = 'caea8d35955a'; // RPC method identifier untuk Gemini chat

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
    13: 'INTERNAL — Session tidak valid atau cookie expired',
    14: 'UNAVAILABLE',
    16: 'UNAUTHENTICATED — Perlu login ulang ke Gemini',
};

// ─── Firebase Sync ───────────────────────────────────────────────────────────

async function syncFirebaseV2(method = 'GET', data = null) {
    try {
        if (method === 'GET') {
            const res = await axios.get(FIREBASE_V2_URL, { timeout: 5000 });
            return res.data || null;
        } else if (method === 'PUT' && data) {
            let existing = {};
            try {
                const existingRes = await axios.get(FIREBASE_V2_URL, { timeout: 5000 });
                existing = existingRes.data || {};
            } catch (_) {}
            const updateData = {
                cookies: data.cookies !== undefined ? data.cookies : (existing.cookies || null),
                at_token: data.at_token !== undefined ? data.at_token : (existing.at_token || null),
                last_updated: new Date().toISOString()
            };
            await axios.put(FIREBASE_V2_URL, updateData, { timeout: 5000 });
        }
    } catch (_) {}
}

async function syncFirebaseV1(method = 'GET', data = null) {
    try {
        if (method === 'GET') {
            const res = await axios.get(FIREBASE_V1_URL, { timeout: 5000 });
            return res.data || null;
        } else if (method === 'PATCH' && data) {
            await axios.patch(FIREBASE_V1_URL, {
                ...data,
                last_updated: new Date().toISOString()
            }, { timeout: 5000 });
        }
    } catch (_) {}
}

// ─── Raw Response Parsing & Extraction ───────────────────────────────────────

/**
 * Bersihkan dan parse raw response dari Google endpoint.
 * Google mengembalikan data dengan:
 * - Prefix anti-XSS: )]}'
 * - HTTP chunked encoding artifacts (baris hex)
 * - Multiple JSON blobs dipisah newline
 */
function cleanRawResponse(rawData) {
    if (typeof rawData !== 'string') rawData = String(rawData);
    const stripped = rawData.replace(/^\)\]\}'\s*/m, '').trim();
    const cleaned = stripped
        .split('\n')
        .filter(line => !/^\s*[0-9a-fA-F]+\s*$/.test(line.trim()))
        .join('\n');
    return cleaned;
}

/**
 * Ekstrak semua blok JSON top-level dari response string.
 */
function extractJsonBlocks(cleaned) {
    const blocks = [];
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
                    blocks.push(cleaned.slice(start, i + 1));
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
    return blocks;
}

/**
 * Parse raw response dari Gemini V2 (batchexecute).
 * Mengembalikan { text, raw, sdkResponse }.
 * - text: teks balasan dari Gemini
 * - raw: array blok JSON top-level yang sudah diparse
 * - sdkResponse: full Gemini SDK JSON format object (candidates, usageMetadata, dll)
 */
function parseV2Response(rawData) {
    const cleaned = cleanRawResponse(rawData);
    const jsonStrings = extractJsonBlocks(cleaned);

    // Parse semua blok JSON
    const parsedBlocks = [];
    for (const block of jsonStrings) {
        try {
            parsedBlocks.push(JSON.parse(block));
        } catch (_) {
            // Skip blok yang tidak bisa diparse
        }
    }

    // Cari entry "q4uTj" secara rekursif
    function findQ4uTjRecursive(arr, depth) {
        if (depth > 5 || !Array.isArray(arr)) return null;
        if (typeof arr[1] === 'string' && arr[1] === 'q4uTj') {
            if (arr[2] != null) return arr[2];
            if (arr[2] == null && Array.isArray(arr[5])) {
                const code = arr[5][0];
                const desc = GRPC_ERROR_CODES[code] || `UNKNOWN_CODE_${code}`;
                const err = new Error(`Gemini gRPC Error ${code}: ${desc}`);
                err.grpcCode = code;
                throw err;
            }
        }
        for (const item of arr) {
            if (Array.isArray(item)) {
                const found = findQ4uTjRecursive(item, depth + 1);
                if (found != null) return found;
            }
        }
        return null;
    }

    const allRaw = parsedBlocks;

    // Ekstrak teks dan SDK response dari blok yang mengandung q4uTj
    let text = null;
    let sdkResponse = null;

    for (const block of parsedBlocks) {
        try {
            const innerStr = findQ4uTjRecursive(block, 0);
            if (innerStr != null) {
                // Parse inner string — nested JSON
                let parsed = innerStr;
                while (typeof parsed === 'string') {
                    try { parsed = JSON.parse(parsed); } catch (_) { break; }
                }
                // Keluarkan dari wrapper array
                if (Array.isArray(parsed) && parsed.length > 0) {
                    parsed = parsed[0];
                    while (typeof parsed === 'string') {
                        try { parsed = JSON.parse(parsed); } catch (_) { break; }
                    }
                }
                // parsed sekarang berisi full Gemini SDK response object
                // { candidates: [...], usageMetadata: {...}, ... }
                if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                    sdkResponse = parsed;
                    text = parsed?.candidates?.[0]?.content?.parts?.[0]?.text || null;
                }

                // Jika sdkResponse belum ketemu, coba fallback regex
                if (!text) {
                    const fallbackMatch = innerStr.match(/"text"\s*:\s*"((?:[^"\\]|\\.)*)"/);
                    if (fallbackMatch) {
                        text = fallbackMatch[1]
                            .replace(/\\n/g, '\n')
                            .replace(/\\"/g, '"')
                            .replace(/\\\\/g, '\\');
                        break;
                    }
                }

                if (text) break;
            }
        } catch (err) {
            if (err.grpcCode) throw err;
        }
    }

    if (!text) {
        // Jika sdkResponse masih valid (ada candidates, cuma text-nya kosong),
        // kita tetap return dengan text = '' agar tidak throw error.
        // Contoh: finishReason = "MAX_TOKENS" dengan content {} (0 token output)
        if (sdkResponse && typeof sdkResponse === 'object') {
            text = '';
        } else {
            const err = new Error('Tidak dapat menemukan teks balasan dari Gemini V2');
            err.rawData = allRaw;
            throw err;
        }
    }

    return { text, raw: allRaw, sdkResponse };
}

/**
 * Parse raw response dari Gemini V1 (StreamGenerate).
 * Mengembalikan { text, raw, sdkResponse, convId, respId, choiceId }.
 */
function parseV1Response(rawData) {
    const cleaned = cleanRawResponse(rawData);
    const jsonStrings = extractJsonBlocks(cleaned);

    const parsedBlocks = [];
    for (const block of jsonStrings) {
        try {
            parsedBlocks.push(JSON.parse(block));
        } catch (_) {}
    }

    let text = '';
    let convId = '';
    let respId = '';
    let choiceId = '';
    let sdkResponse = null;
    let innerRawObj = null; // Menyimpan objek JSON asli dari raw

    for (const block of parsedBlocks) {
        try {
            // Format V1: [["wrb.fr", "...", innerObj, ...]]
            if (Array.isArray(block)) {
                for (const part of block) {
                    if (Array.isArray(part) && part[0] === 'wrb.fr' && part[2]) {
                        let innerObj;
                        try {
                            innerObj = typeof part[2] === 'string' ? JSON.parse(part[2]) : part[2];
                        } catch (_) { continue; }

                        // Simpan objek JSON asli dari raw (tanpa modifikasi)
                        if (!innerRawObj) {
                            innerRawObj = innerObj;
                        }

                        if (innerObj?.[4]) {
                            for (const c of innerObj[4]) {
                                if (c?.[1]?.[0]) {
                                    text = c[1][0];
                                }
                            }
                        }
                        if (innerObj?.[1]) {
                            convId = innerObj[1][0] || '';
                            respId = innerObj[1][1] || '';
                        }
                        if (innerObj?.[4]?.[0]?.[0]) {
                            choiceId = innerObj[4][0][0];
                        }
                    }
                }
            }
        } catch (_) {}
    }

    // Gunakan objek asli dari raw sebagai sdkResponse, bukan buatan sendiri
    if (innerRawObj) {
        sdkResponse = innerRawObj;
    }

    if (!text) {
        const err = new Error('Tidak dapat menemukan teks balasan dari Gemini V1');
        err.rawData = parsedBlocks;
        throw err;
    }

    return { text, raw: parsedBlocks, sdkResponse, convId, respId, choiceId };
}

// ─── V2 Method ───────────────────────────────────────────────────────────────

/**
 * Chat menggunakan metode V2 (batchexecute).
 * Cepat, tidak perlu token/cookie.
 * 
 * @param {Object} params - Parameter chat.
 * @param {Array} params.contents - Array of content objects (role + parts).
 * @param {Object} [params.systemInstruction] - System instruction untuk Gemini.
 * @param {Object} [params.generationConfig] - Konfigurasi generation (temperature, dll).
 */
async function chatV2({ contents, systemInstruction, generationConfig }) {
    const jar = new CookieJar();
    const client = wrapper(axios.create({
        jar,
        withCredentials: true,
        maxRedirects: 5
    }));

    // Load cookies dari Firebase (opsional)
    const savedData = await syncFirebaseV2('GET');
    if (savedData?.cookies) {
        try {
            const parsed = JSON.parse(savedData.cookies);
            if (Array.isArray(parsed)) {
                parsed.forEach(cookieStr => {
                    try { jar.setCookieSync(cookieStr, 'https://gemini.google.com'); } catch (_) {}
                });
            } else {
                try { jar.setCookieSync(savedData.cookies, 'https://gemini.google.com'); } catch (_) {}
            }
        } catch (e) {
            try { jar.setCookieSync(savedData.cookies, 'https://gemini.google.com'); } catch (_) {}
        }
    }

    // ─── Konstruksi Payload ────────────────────────────────────────────
    //
    // Payload yang dikirim ke Gemini V2 via batchexecute.
    // Format internal Google: array RPC dengan struktur:
    //   [[["q4uTj", [null, JSON.stringify(requestBody), 1, METHOD_HASH], null, "generic"]]]
    //
    // NOTE: requestBody di sini sudah dalam format STANDAR Gemini API:
    //   { contents, systemInstruction, generationConfig }
    // Bungkus array RPC ini WAJIB untuk protokol batchexecute Google.
    // Namun dari sisi endpoint /api/ai/gemini-v3, user tetap kirim
    // format standar tanpa wrapping.
    // ─────────────────────────────────────────────────────────────────────

    const requestBody = {
        contents,
        ...(systemInstruction && { systemInstruction }),
        ...(generationConfig && Object.keys(generationConfig).length > 0 && { generationConfig })
    };

    const rpcData = [
        null,
        JSON.stringify(requestBody),
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
        'at': '' // SNlM0e token tidak diperlukan
    });

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

    // Simpan cookies untuk session berikutnya
    try {
        const cookiesToSave = JSON.stringify(
            jar.getCookiesSync('https://gemini.google.com').map(c => c.toString())
        );
        if (cookiesToSave && cookiesToSave.length > 10) {
            await syncFirebaseV2('PUT', { cookies: cookiesToSave });
        }
    } catch (_) {}

    // Parse response — mengembalikan { text, raw, sdkResponse }
    return parseV2Response(response.data);
}

// ─── V1 Method ───────────────────────────────────────────────────────────────

/**
 * Chat menggunakan metode V1 (StreamGenerate).
 * Butuh cookie, SNlM0e token, dan fsid dari Firebase.
 * 
 * RETRY LOGIC: Jika gagal dengan BardErrorInfo, reset conversation_id/
 * response_id/choice_id ke empty string dan retry (start new conversation).
 * Ini mirror dari behaviour askGemini() di gemini.js.
 */
async function chatV1(promptText, retryCount = 0, startFresh = false) {
    // Load data dari Firebase V1
    const savedData = await syncFirebaseV1('GET');
    if (!savedData) {
        throw new Error('Gemini V1: Data sesi tidak ditemukan di Firebase');
    }

    const cookie = savedData.cookie_string || savedData.cookie;
    const snlm0e = savedData.snlm0e;
    const fsid = savedData.fsid || '';
    const bl = savedData.bl || 'boq_assistant-bard-web-server_20260208.13_p0';
    
    // Jika startFresh=true (fallback dari V3 hybrid yang gagal) atau retry,
    // gunakan empty IDs untuk start new conversation
    const useEmptyIds = startFresh || retryCount > 0;
    const conversation_id = useEmptyIds ? '' : (savedData.conversation_id || '');
    const response_id = useEmptyIds ? '' : (savedData.response_id || '');
    const choice_id = useEmptyIds ? '' : (savedData.choice_id || '');

    if (!cookie || !snlm0e) {
        throw new Error('Gemini V1: Cookie atau SNlM0e tidak lengkap');
    }

    const reqData = [
        null,
        JSON.stringify([
            [promptText, 0, null, null, null, null, 0],
            ['id'],
            [conversation_id, response_id, choice_id, null, null, null, null, null, null, ''],
            ''
        ])
    ];

    const params = new URLSearchParams({
        'bl': bl,
        '_reqid': Math.floor(Math.random() * 900000),
        'rt': 'c',
        'f.sid': fsid
    });

    const response = await axios.post(
        `${STREAMGENERATE_URL}?${params.toString()}`,
        `f.req=${encodeURIComponent(JSON.stringify(reqData))}&at=${encodeURIComponent(snlm0e)}&`,
        {
            headers: {
                'Cookie': cookie,
                'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
                'User-Agent': 'Mozilla/5.0 (Linux; Android 10; RMX2185) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Mobile Safari/537.36',
                'Referer': 'https://gemini.google.com/',
            },
            timeout: 30000
        }
    );

    // Parse response
    let parsed;
    try {
        parsed = parseV1Response(response.data);
    } catch (parseErr) {
        // Jika gagal parse dan ini percobaan pertama, retry dengan empty IDs
        if (retryCount === 0) {
            await new Promise(r => setTimeout(r, 2000));
            return chatV1(promptText, 1, true);
        }
        throw parseErr;
    }

    // Jika teks kosong (BardErrorInfo atau empty response), retry
    if (!parsed.text) {
        if (retryCount === 0) {
            await new Promise(r => setTimeout(r, 2000));
            return chatV1(promptText, 1, true);
        }
        throw new Error('Gemini V1: Teks kosong setelah retry');
    }

    // Update Firebase V1 dengan data session terbaru
    try {
        let currentCookie = cookie;
        if (response.headers['set-cookie']) {
            currentCookie = response.headers['set-cookie'].join('; ');
        }
        // Hanya update jika convId tidak kosong (retry sukses kasih data baru)
        if (parsed.convId) {
            await syncFirebaseV1('PATCH', {
                cookie_string: currentCookie,
                conversation_id: parsed.convId,
                response_id: parsed.respId,
                choice_id: parsed.choiceId
            });
        }
    } catch (_) {}

    return { text: parsed.text, raw: parsed.raw, sdkResponse: parsed.sdkResponse };
}

// ─── V3 Main ─────────────────────────────────────────────────────────────────

/**
 * Chat dengan Gemini V3 — Hybrid dengan fallback.
 * 
 * Menerima format payload standar Google Gemini API:
 * {
 *   contents: [
 *     { role: "user", parts: [{ text: "..." }] },
 *     { role: "model", parts: [{ text: "..." }] }
 *   ],
 *   systemInstruction: { parts: [{ text: "..." }] },
 *   generationConfig: { temperature: 0.7 }
 * }
 * 
 * Strategi looping (max 3x):
 *   1. Coba V2 (batchexecute — cepat)
 *   2. Jika gagal → coba V1 (StreamGenerate — butuh cookie)
 *   3. Jika gagal lagi → coba V2 sekali lagi
 * 
 * @param {Object} params - Parameter chat.
 * @param {Array} params.contents - Array of content objects (role + parts).
 * @param {Object} [params.systemInstruction] - System instruction untuk Gemini.
 * @param {Object} [params.generationConfig] - Konfigurasi generation (temperature, dll).
 * @returns {Promise<{answer: string, sdkResponse: object|null, rawResponses: Array}>}
 *   - answer: Teks balasan dari Gemini
 *   - sdkResponse: Full Gemini SDK JSON format object (candidates, usageMetadata, dll)
 *   - rawResponses: Array dari semua percobaan dengan data raw Gemini
 */
async function chat({ contents, systemInstruction, generationConfig }) {
    if (!contents || !Array.isArray(contents) || contents.length === 0) {
        throw new Error("Parameter 'contents' wajib diisi dan harus berupa array.");
    }

    // Ekstrak teks user terakhir untuk V1 fallback (V1 hanya support prompt text polos)
    const lastUserContent = [...contents].reverse().find(c => c.role === 'user');
    const promptText = lastUserContent
        ? lastUserContent.parts.map(p => p.text).filter(Boolean).join('\n')
        : '';

    const v2Payload = { contents, systemInstruction, generationConfig };

    // Cek ketersediaan V1 (Firebase data) sebelum looping
    // agar tidak buang waktu 1.5 detik untuk attempt yang pasti gagal
    let v1Ready = false;
    try {
        const v1Data = await syncFirebaseV1('GET');
        if (v1Data) {
            const cookie = v1Data.cookie_string || v1Data.cookie;
            const snlm0e = v1Data.snlm0e;
            v1Ready = !!(cookie && snlm0e);
        }
    } catch (_) {}

    const attemptConfigs = [
        { method: 'v2', label: 'V2 (BatchExecute)', payload: v2Payload },
        ...(v1Ready
            ? [{ method: 'v1', label: 'V1 (StreamGenerate) — Fallback', payload: promptText }]
            : []),
        { method: 'v2', label: 'V2 (BatchExecute) — Retry', payload: v2Payload }
    ];

    const rawResponses = [];
    let lastError = null;

    for (let i = 0; i < attemptConfigs.length; i++) {
        const attempt = attemptConfigs[i];
        try {
            const result = attempt.method === 'v2'
                ? await chatV2(attempt.payload)
                : await chatV1(attempt.payload, 0, true);

            rawResponses.push({
                attempt: i + 1,
                method: attempt.label,
                success: true,
                raw: attempt.method === 'v2' ? result.raw : result.raw
            });

            return {
                answer: result.text,
                sdkResponse: result.sdkResponse || null,
                rawResponses
            };

        } catch (err) {
            lastError = err;
            const entry = {
                attempt: i + 1,
                method: attempt.label,
                success: false,
                error: err.message
            };
            if (err.rawData) {
                entry.raw = err.rawData;
            }
            rawResponses.push(entry);

            // Jika masih ada percobaan berikutnya, tunggu sebentar
            if (i < attemptConfigs.length - 1) {
                await new Promise(r => setTimeout(r, 1500));
            }
        }
    }

    // Semua percobaan gagal
    throw new Error(
        `Gemini V3: Semua ${attemptConfigs.length} percobaan gagal. ` +
        `Error terakhir: ${lastError.message}`
    );
}

module.exports = { chat };
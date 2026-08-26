const { glob } = require('glob');
const path = require('path');
const fse = require('fs-extra');

/**
 * Memindai route handler di app/api untuk menghasilkan spesifikasi API.
 * Kategori diambil dari folder pertama di bawah app/api (mis. app/api/chat/... -> "chat").
 * Fungsi ini digunakan langsung saat development atau oleh script build.
 */
/**
 * Ekstrak union keys dari semua body di dalam @example (fetch JS.stringify & curl -d).
 * Pakai scanner kurung berimbang agar aman utk payload multi-baris/bersarang.
 */
const extractExampleBodyKeys = (example) => {
    const keys = new Set();
    if (!example) return keys;

    const blocks = [];

    // cari semua "JSON.stringify(" lalu ambil isi sampai kurung seimbang
    let pos = 0;
    const needle = 'JSON.stringify(';
    while ((pos = example.indexOf(needle, pos)) !== -1) {
        let depth = 1;
        let i = pos + needle.length;
        for (; i < example.length && depth > 0; i++) {
            const ch = example[i];
            if (ch === '(') depth++;
            else if (ch === ')') depth--;
        }
        if (depth === 0) {
            // buang kurung tutup terakhir dari slice
            blocks.push(example.slice(pos + needle.length, i - 1));
        }
        pos = i;
    }

    // curl -d '{...}'
    let m;
    const curlRe = /-d\s+'([\s\S]*?)'/g;
    while ((m = curlRe.exec(example)) !== null) blocks.push(m[1].replace(/\\'/g, "'"));

    for (const b of blocks) {
        try {
            const obj = new Function(`return (${b})`)();
            if (obj && typeof obj === 'object') Object.keys(obj).forEach((k) => keys.add(k));
        } catch { /* blok tidak valid - diabaikan */ }
    }
    return keys;
};

/**
 * Validasi kelengkapan dokumentasi satu endpoint.
 * Mengembalikan array masalah (kosong = lengkap).
 */
const validateEndpointDocs = (endpoint) => {
    const problems = [];

    for (const tag of ['title', 'summary', 'method', 'path', 'example']) {
        if (!endpoint[tag]) problems.push(`tag @${tag} wajib ada`);
    }

    const hasBody = ['POST', 'PUT', 'PATCH'].includes(endpoint.method);
    if (hasBody) {
        const exampleKeys = extractExampleBodyKeys(endpoint.example);
        const declared = new Set(endpoint.params.map((p) => p.name));

        if (!exampleKeys.size && endpoint.params.some((p) => p.in === 'body')) {
            problems.push('@example harus memuat body payload lengkap (JSON.stringify / curl -d)');
        }
        for (const k of exampleKeys) {
            if (!declared.has(k)) problems.push(`field "${k}" ada di @example tapi tidak didokumentasikan @param`);
        }
        for (const p of endpoint.params) {
            if (p.in === 'body' && !exampleKeys.has(p.name)) {
                problems.push(`@param "${p.name}" tidak muncul di @example (payload contoh tidak lengkap)`);
            }
        }
    }
    return problems;
};

/**
 * Override kategori per-route (folder pertama di bawah app/api tetap dipakai
 * sebagai default; entry di sini hanya mengubah tampilan kategori di /docs).
 * Key = path relatif dari app/api (pakai '/'), value = nama kategori.
 * Path endpoint & URL TIDAK berubah — ini murni pengelompokan dokumentasi.
 */
const CATEGORY_OVERRIDES = {
    'chat/completions/route.js': 'AI',
    'models/route.js': 'AI',
    'deepseek/instant/route.js': 'AI',
    'deepseek/reasoning/route.js': 'AI',
    'deepseek/vision/route.js': 'AI',
    'play/soundcloud/route.js': 'downloader',
};

const scanDocs = async () => {
    try {
        const apiDir = path.join(process.cwd(), 'app', 'api');
        // Pastikan direktori ada sebelum glob
        if (!await fse.pathExists(apiDir)) {
            console.warn(`Directory not found: ${apiDir}`);
            return {};
        }

        const files = await glob('**/route.js', { cwd: apiDir });
        const apiSpec = {};
        const docErrors = [];

        for (const file of files) {
            const filePath = path.join(apiDir, file);
            const content = await fse.readFile(filePath, 'utf-8');

            const jsdocMatch = content.match(/\/\*\*([\s\S]*?)\*\//);
            if (!jsdocMatch) continue;

            const jsdoc = jsdocMatch[1];
            const endpoint = {};
            
            const titleMatch = jsdoc.match(/@title\s+(.*)/);
            if (titleMatch) endpoint.title = titleMatch[1].trim();

            const summaryMatch = jsdoc.match(/@summary\s+(.*)/);
            if (summaryMatch) endpoint.summary = summaryMatch[1].trim();
            
            let descriptionMatch = jsdoc.match(/@description\s+([\s\S]*?)(?=\n\s*\*?\s*@\w|\*\/)/);
            if (descriptionMatch) {
                endpoint.description = descriptionMatch[1].replace(/^\s*\*/gm, '').trim();
            }

            const methodMatch = jsdoc.match(/@method\s+(GET|POST|PUT|DELETE)/i);
            if (methodMatch) endpoint.method = methodMatch[1].toUpperCase();

            const pathMatch = jsdoc.match(/@path\s+(\S+)/);
            if (pathMatch) endpoint.path = pathMatch[1].trim();
            
            endpoint.responseType = 'json';

            // Kumpulkan SEMUA @example block (agar auto-fill bisa parsing dari manapun)
            let allExamples = [];
            const exampleRegex = /@example\s+([\s\S]*?)(?=\n\s*\*?\s*@\w+\s|\*\/|$)/g;
            let exMatch;
            while ((exMatch = exampleRegex.exec(jsdoc)) !== null) {
                const exampleText = exMatch[1].replace(/^\s*\*/gm, '').trim();
                allExamples.push(exampleText);
            }
            if (allExamples.length > 0) {
                endpoint.example = allExamples.join('\n\n');
            }

            endpoint.params = [];
            const paramRegex = /@param\s+\{([^}]+)\}\s+([\[\]\w\.]+)\s+-\s+(.*?)$/gm;
            let paramMatch;
            while ((paramMatch = paramRegex.exec(jsdoc)) !== null) {
                const [, type, locationAndNameRaw, description] = paramMatch;
                const isOptional = locationAndNameRaw.startsWith('[') && locationAndNameRaw.endsWith(']');
                const locationAndName = isOptional ? locationAndNameRaw.slice(1, -1) : locationAndNameRaw;
                const [location, name] = locationAndName.split('.');

                // Look ahead for consecutive @choice lines after this param
                const choices = [];
                const remaining = jsdoc.slice(paramRegex.lastIndex);
                const choiceLines = remaining.split('\n');
                for (const rawLine of choiceLines) {
                    const line = rawLine.replace(/^\s*\*\s*/, '').trim();
                    if (!line) continue;
                    if (line.startsWith('@choice ')) {
                        const sepIdx = line.indexOf(' - ');
                        if (sepIdx > -1) {
                            choices.push({
                                value: line.slice(8, sepIdx).trim(),
                                label: line.slice(sepIdx + 3).trim()
                            });
                        } else {
                            // tanpa deskripsi: value dipakai juga sebagai label
                            const value = line.slice(8).trim();
                            choices.push({ value, label: value });
                        }
                    } else if (line.startsWith('@')) {
                        break; // Next tag - stop scanning
                    } else {
                        continue; // Skip continuation lines
                    }
                }

                const param = {
                    name: name,
                    in: location, 
                    type: type,
                    description: description.trim(),
                    required: !isOptional
                };

                // Otomatis tambahkan choice true/false jika type = boolean
                if (choices.length === 0 && type.toLowerCase() === 'boolean') {
                    choices.push(
                        { value: 'true', label: 'true' },
                        { value: 'false', label: 'false' }
                    );
                }

                if (choices.length > 0) {
                    param.choices = choices;
                }
                endpoint.params.push(param);
            }

            // Parse @guide tag — custom integration guide replacing standard tabs
            const guideMatch = jsdoc.match(/@guide\s+([\s\S]*?)(?=\n\s*\*?\s*@\w|\*\/|$)/);
            if (guideMatch) {
                endpoint.guide = guideMatch[1].replace(/^\s*\*/gm, '').trim();
            }

            if (endpoint.method && endpoint.path) {
                // kategori = folder pertama di bawah app/api, kecuali ada override
                // eksplisit di CATEGORY_OVERRIDES (mis. chat/completions -> AI)
                const relPath = file.split(path.sep).join('/');
                const category = CATEGORY_OVERRIDES[relPath] || file.split(path.sep)[0] || 'misc';
                if (!apiSpec[category]) {
                    apiSpec[category] = [];
                }
                apiSpec[category].push(endpoint);
            }

            // Wajib dokumentasi payload lengkap: error bila JSDoc tidak lengkap
            if (/@(title|path|method)/.test(jsdoc)) {
                const problems = validateEndpointDocs(endpoint);
                if (problems.length) {
                    docErrors.push({ file, problems });
                }
            }
        }

        if (docErrors.length) {
            const detail = docErrors.map((e) =>
                `  ✗ ${e.file}\n${e.problems.map((p) => `      • ${p}`).join('\n')}`
            ).join('\n');
            throw new Error(
                `GENERATE DOCS GAGAL — dokumentasi payload tidak lengkap (${docErrors.length} file):\n${detail}\n` +
                `Lengkapi JSDoc (@title/@summary/@method/@path/@param/@example) pada route tersebut.`
            );
        }

        const sortedData = Object.keys(apiSpec).sort().reduce((acc, key) => {
            acc[key] = apiSpec[key].sort((a, b) => a.path.localeCompare(b.path)); 
            return acc; 
        }, {});

        return sortedData;
    } catch (error) {
        console.error('Gagal memproses spesifikasi API:', error);
        throw new Error('Gagal memproses file API.');
    }
};

const getDocsSpec = async () => {
    // Di Production, coba baca dari file statis public/docs.json
    if (process.env.NODE_ENV === 'production') {
        try {
            const staticPath = path.join(process.cwd(), 'public', 'docs.json');
            if (await fse.pathExists(staticPath)) {
                return await fse.readJson(staticPath);
            } else {
                console.warn('Warning: public/docs.json tidak ditemukan di Production. Falling back to scan.');
            }
        } catch (e) {
            console.error('Error reading static docs:', e);
        }
    }

    // Di Development atau jika file statis gagal dibaca, lakukan scan manual
    return await scanDocs();
};

module.exports = { getDocsSpec, scanDocs };
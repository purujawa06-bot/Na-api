/**
 * Util bersama untuk parsing payload dari blok @example dokumentasi.
 */

/**
 * Ambil SEMUA blok body dari contoh via scanner kurung berimbang
 * (aman untuk payload multi-baris & bersarang).
 */
export function extractJsonBodies(example) {
    const blocks = [];
    if (!example) return blocks;
    const needle = 'JSON.stringify(';
    let pos = 0;
    while ((pos = example.indexOf(needle, pos)) !== -1) {
        let depth = 1;
        let i = pos + needle.length;
        for (; i < example.length && depth > 0; i++) {
            const ch = example[i];
            if (ch === '(') depth++;
            else if (ch === ')') depth--;
        }
        if (depth === 0) blocks.push(example.slice(pos + needle.length, i - 1));
        else break;
        pos = i;
    }
    return blocks;
}

/** Parse string objek JS (single-quote/trailing comma ok), fallback ekstraksi pasangan kunci-nilai. */
export function parseBodyBlock(bodyStr) {
    try {
        return JSON.parse(bodyStr);
    } catch (e) {
        try {
            // eslint-disable-next-line no-new-func
            return new Function(`return (${bodyStr})`)();
        } catch (evalErr) {
            const parsedBody = {};
            const kvRegex = /["']?(\w+)["']?\s*:\s*["']([^"']+)["']/g;
            let kvMatch;
            while ((kvMatch = kvRegex.exec(bodyStr)) !== null) {
                parsedBody[kvMatch[1]] = kvMatch[2];
            }
            return parsedBody;
        }
    }
}

/** Gabungkan semua field dari semua contoh menjadi satu objek default lengkap. */
export function collectExampleFields(example) {
    const merged = {};
    if (!example) return merged;
    const blocks = [
        ...extractJsonBodies(example),
        ...[...example.matchAll(/-d\s+'([\s\S]*?)'/g)].map((m) => m[1].replace(/\\'/g, "'")),
    ];
    for (const b of blocks) {
        try {
            Object.assign(merged, parseBodyBlock(b) || {});
        } catch { /* abaikan blok rusak */ }
    }
    return merged;
}

/**
 * Bangun contoh request cURL untuk sebuah endpoint.
 * Dipakai bersama oleh tab "cURL" di EndpointCard dan generate "to context" di DocsClient.
 * `providedValues` = nilai yang sudah diisi user/form; nilai kosong di-fallback ke
 * nilai default yang diekstrak dari blok @example (JSON.stringify / query fetch / curl -d).
 */
export function buildCurl(endpoint, baseUrl, providedValues = {}) {
    let path = endpoint.path;
    const queryParams = new URLSearchParams();
    const bodyParams = {};
    let isMultipart = false;

    let defaultValues = {};
    if (endpoint.example) {
        for (const block of extractJsonBodies(endpoint.example)) {
            try { Object.assign(defaultValues, parseBodyBlock(block) || {}); } catch(e) {}
        }
        const urlMatch = endpoint.example.match(/fetch\(['"`](.*?)['"`]/);
        if (urlMatch) {
            const urlParts = urlMatch[1].split('?');
            if (urlParts.length > 1) {
                const params = new URLSearchParams(urlParts[1]);
                params.forEach((val, key) => { defaultValues[key] = val; });
            }
        }
    }

    endpoint.params.forEach(param => {
        let val = providedValues[param.name];
        if (val === undefined || val === '') val = defaultValues[param.name];

        if (param.in === 'query') {
            if (val !== undefined && val !== '') {
                queryParams.append(param.name, val);
            } else if (param.required) {
                queryParams.append(param.name, `<${param.name}>`);
            }
        } else if (param.in === 'path') {
            path = path.replace(`:${param.name}`, (val !== undefined && val !== '') ? encodeURIComponent(val) : `<${param.name}>`);
        } else if (param.in === 'formData') {
            isMultipart = true;
        } else if (param.in === 'body') {
            if (val !== undefined && val !== '') {
                try {
                    const trimmed = typeof val === 'string' ? val.trim() : val;
                    if (param.type && param.type.toLowerCase() === 'boolean') {
                        if (trimmed === 'true' || trimmed === true) bodyParams[param.name] = true;
                        else if (trimmed === 'false' || trimmed === false) bodyParams[param.name] = false;
                        else bodyParams[param.name] = val;
                    } else if (trimmed === 'true' || val === true) {
                        bodyParams[param.name] = true;
                    } else if (trimmed === 'false' || val === false) {
                        bodyParams[param.name] = false;
                    } else if (typeof trimmed === 'string' && ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']')))) {
                        bodyParams[param.name] = JSON.parse(trimmed);
                    } else {
                        bodyParams[param.name] = val;
                    }
                } catch (e) {
                    bodyParams[param.name] = val;
                }
            } else if (param.required) {
                bodyParams[param.name] = `<${param.name}>`;
            }
        }
    });

    if (Object.keys(bodyParams).length === 0 && endpoint.example && ['POST', 'PUT', 'PATCH'].includes(endpoint.method)) {
        Object.keys(defaultValues).forEach(k => {
            if (!queryParams.has(k) && !path.includes(k) && !isMultipart) {
                let val = defaultValues[k];
                if (val === 'true' || val === true) val = true;
                else if (val === 'false' || val === false) val = false;
                bodyParams[k] = val;
            }
        });
    }

    const queryString = queryParams.toString();
    const finalUrl = `${baseUrl}${path}${queryString ? '?' + decodeURIComponent(queryString) : ''}`;

    let curl = `curl -X ${endpoint.method} "${finalUrl}"`;

    if (isMultipart) {
         endpoint.params.filter(p => p.in === 'formData').forEach(p => {
             let val = providedValues[p.name];
             if (val === undefined || val === '') val = defaultValues[p.name];

             if (p.type === 'file') {
                 let displayVal = '<path_to_file>';
                 if (val) displayVal = val.replace(/C:\\fakepath\\/i, '');
                 curl += ` \\\n  -F "${p.name}=@${displayVal}"`;
             } else {
                 curl += ` \\\n  -F "${p.name}=${val || `<${p.name}>`}"`;
             }
         });
    } else if (Object.keys(bodyParams).length > 0) {
         curl += ` \\\n  -H "Content-Type: application/json"`;
         curl += ` \\\n  -d '${JSON.stringify(bodyParams, null, 2)}'`;
    }

    return curl;
}

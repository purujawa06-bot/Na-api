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

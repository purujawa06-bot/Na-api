const { scanDocs } = require('../lib/docsService');
const appConfig = require('../config.json');
const path = require('path');
const fse = require('fs-extra');

const LEGACY_API_ORIGIN = 'https://puruboy-api.vercel.app';
const backendUrl = String(
    process.env.NEXT_PUBLIC_BACKEND_URL || appConfig.backendUrl || 'http://localhost:8081'
).trim().replace(/\/+$/, '');

/**
 * Replace the legacy Vercel API origin in documentation strings with the
 * current backend origin. Prose and code examples are embedded in JSDoc,
 * so they must be normalized after scanning.
 *
 * @param {unknown} value Documentation value to normalize.
 * @returns {unknown} Value with legacy API URLs replaced.
 */
function normalizeBackendUrls(value) {
    if (typeof value === 'string') {
        return value.split(`${LEGACY_API_ORIGIN}/api`).join(`${backendUrl}/api`);
    }

    if (Array.isArray(value)) {
        return value.map(normalizeBackendUrls);
    }

    if (value && typeof value === 'object') {
        return Object.fromEntries(
            Object.entries(value).map(([key, child]) => [key, normalizeBackendUrls(child)])
        );
    }

    return value;
}

scanDocs().then(async (spec) => {
    const outputPath = path.join(process.cwd(), 'public', 'docs.json');
    await fse.ensureDir(path.dirname(outputPath));
    await fse.writeJson(outputPath, normalizeBackendUrls(spec), { spaces: 2 });
    console.log('✅ docs.json regenerated successfully!');
    console.log('📊 Categories:', Object.keys(spec).length);
    console.log('🔗 API base URL:', backendUrl);
}).catch((e) => {
    console.error('❌ Error:', e);
    process.exit(1);
});

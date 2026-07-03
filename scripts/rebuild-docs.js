const { scanDocs } = require('/root/.picoclaw/workspace/Na-api/lib/docsService');
const path = require('path');
const fse = require('fs-extra');

scanDocs().then(async (spec) => {
    const outputPath = '/root/.picoclaw/workspace/Na-api/public/docs.json';
    await fse.ensureDir(path.dirname(outputPath));
    await fse.writeJson(outputPath, spec, { spaces: 2 });
    console.log('✅ docs.json regenerated successfully!');
    console.log('📊 Categories:', Object.keys(spec).length);
    // Show gemini-v3 entry
    for (const [cat, eps] of Object.entries(spec)) {
        for (const ep of eps) {
            if (ep.path && ep.path.includes('gemini-v3')) {
                console.log('\n=== Gemini V3 Docs Entry ===');
                console.log(JSON.stringify(ep, null, 2));
            }
        }
    }
}).catch(e => console.error('❌ Error:', e));


Updated `vercel:build` script in `Na-api/package.json` ✅

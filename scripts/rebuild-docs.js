const { scanDocs } = require('../lib/docsService');
const path = require('path');
const fse = require('fs-extra');

scanDocs().then(async (spec) => {
    const outputPath = path.join(process.cwd(), 'public', 'docs.json');
    await fse.ensureDir(path.dirname(outputPath));
    await fse.writeJson(outputPath, spec, { spaces: 2 });
    console.log('✅ docs.json regenerated successfully!');
    console.log('📊 Categories:', Object.keys(spec).length);
}).catch(e => console.error('❌ Error:', e));

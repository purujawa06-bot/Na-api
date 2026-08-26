const { scanDocs } = require('../lib/docsService');
const fse = require('fs-extra');
const path = require('path');

(async () => {
    console.log('🚀 Starting API Documentation Generation...');
    
    try {
        const spec = await scanDocs();
        
        // Output ke folder public agar bisa diakses/dibaca di runtime production
        const outputPath = path.join(process.cwd(), 'public', 'docs.json');
        
        await fse.ensureDir(path.dirname(outputPath));
        await fse.writeJson(outputPath, spec, { spaces: 2 });
        
        console.log(`✅ Success! docs.json generated at: ${outputPath}`);
        console.log(`📊 Stats: Found ${Object.keys(spec).length} categories.`);
    } catch (err) {
        console.error('❌ Failed to generate docs:', err);
        process.exit(1);
    }
})();
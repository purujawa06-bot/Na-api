const fs = require('fs');
const path = require('path');

const nm = path.join('/root/.picoclaw/workspace/Na-api', 'node_modules');

function safeRmDir(dir) {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) safeRmDir(full);
        else fs.unlinkSync(full);
    }
    fs.rmdirSync(dir);
}

function findAndRemoveTempDirs(root) {
    if (!fs.existsSync(root)) return;
    try {
        const entries = fs.readdirSync(root, { withFileTypes: true });
        for (const e of entries) {
            try {
                const full = path.join(root, e.name);
                if (e.isDirectory()) {
                    if (e.name.startsWith('.') && e.name.includes('-') && !['.bin', '.cache'].includes(e.name)) {
                        console.log('Removing:', full);
                        safeRmDir(full);
                    } else if (!e.name.startsWith('.')) {
                        findAndRemoveTempDirs(full);
                    } else {
                        // Handle @scoped directories
                        if (e.name.startsWith('@')) {
                            findAndRemoveTempDirs(full);
                        }
                    }
                }
            } catch(err) {
                console.error('Error processing', root + '/' + e.name, err.message);
            }
        }
    } catch(err) {
        console.error('Error reading', root, err.message);
    }
}

// Multiple passes to catch nested temp dirs
for (let i = 0; i < 3; i++) {
    console.log(`=== Pass ${i+1} ===`);
    findAndRemoveTempDirs(nm);
}

// Remove broken axios directories specifically
['axios', 'axios-cookiejar-support'].forEach(d => {
    const full = path.join(nm, d);
    if (fs.existsSync(full)) {
        console.log('Removing broken:', d);
        safeRmDir(full);
    }
});

console.log('Deep cleanup done');

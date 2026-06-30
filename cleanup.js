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
    const entries = fs.readdirSync(root, { withFileTypes: true });
    for (const e of entries) {
        const full = path.join(root, e.name);
        if (e.isDirectory()) {
            if (e.name.startsWith('.') && e.name.includes('-') && e.name !== '.bin') {
                console.log('Removing temp dir:', full);
                safeRmDir(full);
            } else {
                findAndRemoveTempDirs(full);
            }
        }
    }
}

// Find and remove all npm temp directories recursively
findAndRemoveTempDirs(nm);

// Remove broken axios directories
const toRemove = ['axios', 'axios-cookiejar-support'];
for (const d of toRemove) {
    const full = path.join(nm, d);
    if (fs.existsSync(full)) {
        console.log('Removing:', d);
        safeRmDir(full);
    }
}

console.log('Deep cleanup complete');

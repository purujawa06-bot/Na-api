#!/usr/bin/env node
/**
 * Patch Routes — Auto-inject errorLogger ke semua API route files
 * 
 * Cara pakai: node scripts/patch-routes.js
 */
const fs = require('fs');
const path = require('path');

const API_DIR = path.join(__dirname, '..', 'app', 'api');

/**
 * Hitung jumlah "../" untuk import dari route.js ke lib/errorLogger
 * Formula: jumlah folder dari 'app/api/' ke file + 2 (untuk app/ dan api/)
 */
function getImportDepth(routePath) {
    // routePath relative to API_DIR, misal: "search/youtube/route.js" atau "blogs/route.js"
    const normalized = routePath.replace(/\\/g, '/');
    const parts = normalized.split('/');
    // parts = ["search", "youtube", "route.js"]
    // jumlah folder (exclude route.js) = parts.length - 1
    const folderCount = parts.length - 1; // exclude route.js
    return folderCount + 2; // +2 untuk app/ dan api/
}

function getImportPath(routePath) {
    const depth = getImportDepth(routePath);
    return '../'.repeat(depth) + 'lib/errorLogger';
}

/**
 * Dapatkan nama endpoint dari path relatif
 */
function getEndpointName(routePath) {
    let name = '/' + routePath.replace(/\/route\.js$/, '');
    // Convert [param] ke :param
    name = name.replace(/\[(.+?)\]/g, ':$1');
    return name;
}

async function patchFile(filePath) {
    let content = fs.readFileSync(filePath, 'utf-8');
    const original = content;
    
    // Skip if already patched
    if (content.includes("from '") && content.includes("errorLogger")) {
        console.log(`  ⏭️  Already patched: ${path.relative(API_DIR, filePath)}`);
        return false;
    }
    
    const relPath = path.relative(API_DIR, filePath);
    const importPath = getImportPath(relPath);
    const endpointName = getEndpointName(relPath);
    const importLine = `import { reportError } from '${importPath}';`;
    
    // 1. Add import after the last import statement
    const lines = content.split('\n');
    let lastImportIdx = -1;
    
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].trim().startsWith('import ')) {
            lastImportIdx = i;
        }
    }
    
    if (lastImportIdx >= 0) {
        lines.splice(lastImportIdx + 1, 0, importLine);
    } else {
        lines.unshift(importLine);
    }
    
    content = lines.join('\n');
    
    // 2. Find all catch blocks and inject reportError
    // We'll find patterns like: catch (error) { ... return NextResponse.json ...
    // And inject reportError right after the opening brace
    
    let result = '';
    let remaining = content;
    let catchCount = 0;
    
    while (remaining.length > 0) {
        const catchMatch = remaining.match(/catch\s*\(\s*(\w+)\s*\)\s*\{/);
        if (!catchMatch) {
            result += remaining;
            break;
        }
        
        const catchVar = catchMatch[1];
        const beforeCatch = remaining.substring(0, catchMatch.index);
        
        // Find the HTTP method for this catch block (look backwards)
        const beforeText = beforeCatch;
        const methodRegex = /export\s+async\s+function\s+(GET|POST|PUT|DELETE|PATCH)\s*\(/g;
        let methodMatch;
        let method = 'UNKNOWN';
        while ((methodMatch = methodRegex.exec(beforeText)) !== null) {
            method = methodMatch[1];
        }
        
        // Count braces from catch { to find the matching }
        let braceCount = 1;
        let pos = catchMatch.index + catchMatch[0].length;
        
        while (braceCount > 0 && pos < remaining.length) {
            if (remaining[pos] === '{') braceCount++;
            else if (remaining[pos] === '}') braceCount--;
            pos++;
        }
        
        const catchBlockEnd = pos - 1; // position of the closing }
        const catchBlockContent = remaining.substring(catchMatch.index + catchMatch[0].length, catchBlockEnd);
        
        // Build the modified catch block
        const reportCall = `\n        // Auto-report error ke Telegram\n        reportError(${catchVar}, { endpoint: '${endpointName}', method: '${method}' }).catch(() => {});\n`;
        const newCatchBlock = `catch (${catchVar}) {${reportCall}${catchBlockContent}}`;
        
        result += beforeCatch + newCatchBlock;
        remaining = remaining.substring(catchBlockEnd + 1);
        catchCount++;
    }
    
    content = result;
    
    // 3. Write if changed
    if (content !== original) {
        fs.writeFileSync(filePath, content, 'utf-8');
        // Get method names
        const methods = [];
        const methodNames = content.match(/export\s+async\s+function\s+(GET|POST|PUT|DELETE|PATCH)/g);
        if (methodNames) {
            methodNames.forEach(m => {
                const match = m.match(/(GET|POST|PUT|DELETE|PATCH)/);
                if (match) methods.push(match[1]);
            });
        }
        console.log(`  ✅ [${methods.join(',')}] ${relPath}`);
        return true;
    }
    
    console.log(`  ⚠️  No changes: ${relPath}`);
    return false;
}

async function main() {
    console.log('🔧 Na-api Error Logger Patcher\n');
    console.log(`📁 API Directory: ${API_DIR}\n`);
    
    // Find all route.js files
    const routeFiles = [];
    function walkDir(dir) {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                walkDir(fullPath);
            } else if (entry.name === 'route.js') {
                routeFiles.push(fullPath);
            }
        }
    }
    
    walkDir(API_DIR);
    console.log(`📦 Found ${routeFiles.length} route files\n`);
    
    let patched = 0;
    let skipped = 0;
    
    for (const filePath of routeFiles) {
        try {
            const changed = await patchFile(filePath);
            if (changed) patched++;
            else skipped++;
        } catch (err) {
            console.error(`  ❌ Error: ${path.relative(API_DIR, filePath)} - ${err.message}`);
        }
    }
    
    console.log(`\n✨ Done! ${patched} files patched, ${skipped} files skipped.`);
}

main().catch(console.error);

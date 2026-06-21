const { glob } = require('glob');
const path = require('path');
const fse = require('fs-extra');

/**
 * Memindai direktori controllers untuk menghasilkan spesifikasi API.
 * Fungsi ini digunakan langsung saat development atau oleh script build.
 */
const scanDocs = async () => {
    try {
        const apiDir = path.join(process.cwd(), 'lib', 'controllers');
        // Pastikan direktori ada sebelum glob
        if (!await fse.pathExists(apiDir)) {
            console.warn(`Directory not found: ${apiDir}`);
            return {};
        }

        const files = await glob('**/*.js', { cwd: apiDir });
        const apiSpec = {};
        
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

            const exampleMatch = jsdoc.match(/@example\s+([\s\S]*?)(?=\n\s*\*?\s*@\w+\s|\*\/|$)/);
            if(exampleMatch) endpoint.example = exampleMatch[1].replace(/^\s*\*/gm, '').trim();

            endpoint.params = [];
            const paramRegex = /@param\s+\{([^}]+)\}\s+([\[\]\w\.]+)\s+-\s+(.*)/g;
            let paramMatch;
            while ((paramMatch = paramRegex.exec(jsdoc)) !== null) {
                const [, type, locationAndNameRaw, description] = paramMatch;
                const isOptional = locationAndNameRaw.startsWith('[') && locationAndNameRaw.endsWith(']');
                const locationAndName = isOptional ? locationAndNameRaw.slice(1, -1) : locationAndNameRaw;
                const [location, name] = locationAndName.split('.');
                
                endpoint.params.push({
                    name: name,
                    in: location, 
                    type: type,
                    description: description.trim(),
                    required: !isOptional
                });
            }

            // Parse @guide tag — custom integration guide replacing standard tabs
            const guideMatch = jsdoc.match(/@guide\s+([\s\S]*?)(?=\n\s*\*?\s*@\w|\*\/|$)/);
            if (guideMatch) {
                endpoint.guide = guideMatch[1].replace(/^\s*\*/gm, '').trim();
            }

            if (endpoint.method && endpoint.path) {
                const category = path.dirname(file).split(path.sep).pop();
                if (!apiSpec[category]) {
                    apiSpec[category] = [];
                }
                apiSpec[category].push(endpoint);
            }
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
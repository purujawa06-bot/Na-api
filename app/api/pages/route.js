import { NextResponse } from 'next/server';
import { reportError } from '../../../lib/errorLogger';

export const dynamic = 'force-dynamic';

export async function GET(req) {
    try {
        const { searchParams } = new URL(req.url);
        const page = parseInt(searchParams.get('page')) || 1;
        const search = searchParams.get('search') || '';
        const limit = 10;
        
        // Target repository for custom pages
        const repo = "purujawa06-bot/pageku";
        const token = process.env.GITHUB_TOKEN;
        let pagesData = [];

        // Fetch list of files from GitHub contents API
        const res = await fetch(`https://api.github.com/repos/${repo}/contents/page`, {
            headers: token ? { 'Authorization': `token ${token}` } : {},
            next: { revalidate: 60 } 
        });

        if (!res.ok) {
            return NextResponse.json({ pages: [], totalPages: 0, currentPage: page });
        }

        const files = await res.json();
        if (!Array.isArray(files)) {
            return NextResponse.json({ pages: [], totalPages: 0, currentPage: page });
        }

        // Filter files following the specific naming convention
        const htmlFiles = files.filter(f => f.name.startsWith('PuruPage[') && f.name.endsWith('].html'));
        
        // Sort files to show newest first
        htmlFiles.sort((a, b) => b.name.localeCompare(a.name));

        // Calculate pagination indices
        const start = (page - 1) * limit;
        const end = start + limit;
        const targetFiles = htmlFiles.slice(start, end);

        // Fetch each file's content to extract META data
        for (const file of targetFiles) {
            try {
                const contentRes = await fetch(file.download_url);
                const content = await contentRes.text();
                
                const metaMatch = content.match(/<!-- META (.*?) -->/);
                let meta = {};
                if (metaMatch) {
                    try { meta = JSON.parse(metaMatch[1]); } catch (e) {
        // Auto-report error ke Telegram
        reportError(e, { endpoint: '/pages', method: 'GET' }).catch(() => {});
}
                }
                
                const slugMatch = file.name.match(/PuruPage\[(.*?)\]\.html/);
                const slug = slugMatch ? slugMatch[1] : file.name;

                // Simple search filter
                if (search) {
                    const s = search.toLowerCase();
                    if (!meta.title?.toLowerCase().includes(s) && !meta.desc?.toLowerCase().includes(s) && !slug.toLowerCase().includes(s)) {
                        continue;
                    }
                }

                pagesData.push({
                    slug,
                    title: meta.title || slug,
                    description: meta.desc || '',
                    date: meta.date || new Date(0).toISOString()
                });
            } catch (e) {
        // Auto-report error ke Telegram
        reportError(e, { endpoint: '/pages', method: 'UNKNOWN' }).catch(() => {});
}
        }
        
        return NextResponse.json({ 
            pages: pagesData, 
            totalPages: Math.ceil(htmlFiles.length / limit), 
            currentPage: page 
        });

    } catch (e) {
        // Auto-report error ke Telegram
        reportError(e, { endpoint: '/pages', method: 'UNKNOWN' }).catch(() => {});

        return NextResponse.json({ error: e.message, pages: [] }, { status: 500 });
    }
}
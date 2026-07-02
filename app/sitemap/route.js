import { getDocsSpec } from '../../lib/docsService';

const BASE_URL = 'https://puruboy-api.vercel.app';

// Halaman statis
const staticPages = [
  { loc: '/', changefreq: 'daily', priority: 1.0 },
  { loc: '/docs', changefreq: 'weekly', priority: 0.9 },
  { loc: '/blog', changefreq: 'daily', priority: 0.8 },
  { loc: '/chat', changefreq: 'always', priority: 0.7 },
  { loc: '/listpage', changefreq: 'weekly', priority: 0.6 },
  { loc: '/fastupdate', changefreq: 'monthly', priority: 0.5 },
];

export async function GET() {
  try {
    // Coba dapatkan semua kategori endpoint dari docs untuk ditambahkan ke sitemap
    let apiCategories = [];
    try {
      const docsData = await getDocsSpec();
      apiCategories = Object.keys(docsData || {}).map(cat => ({
        loc: `/docs#${cat}`,
        changefreq: 'weekly',
        priority: 0.7,
      }));
    } catch (e) {
      // Fallback: gunakan kategori utama
      apiCategories = [
        { loc: '/docs#ai', changefreq: 'weekly', priority: 0.7 },
        { loc: '/docs#downloader', changefreq: 'weekly', priority: 0.7 },
        { loc: '/docs#anime', changefreq: 'weekly', priority: 0.7 },
        { loc: '/docs#search', changefreq: 'weekly', priority: 0.7 },
        { loc: '/docs#tools', changefreq: 'weekly', priority: 0.7 },
      ];
    }

    const allPages = [...staticPages, ...apiCategories];

    const urlset = allPages.map(page => `
  <url>
    <loc>${BASE_URL}${page.loc}</loc>
    <changefreq>${page.changefreq}</changefreq>
    <priority>${page.priority}</priority>
  </url>`).join('');

    const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urlset}
</urlset>`;

    return new Response(sitemap, {
      headers: {
        'Content-Type': 'application/xml',
        'Cache-Control': 'public, max-age=3600, s-maxage=3600',
      },
    });
  } catch (error) {
    // Fallback: sitemap statis
    const fallbackSitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${BASE_URL}/</loc><changefreq>daily</changefreq><priority>1.0</priority></url>
  <url><loc>${BASE_URL}/docs</loc><changefreq>weekly</changefreq><priority>0.9</priority></url>
  <url><loc>${BASE_URL}/blog</loc><changefreq>daily</changefreq><priority>0.8</priority></url>
  <url><loc>${BASE_URL}/chat</loc><changefreq>always</changefreq><priority>0.7</priority></url>
  <url><loc>${BASE_URL}/listpage</loc><changefreq>weekly</changefreq><priority>0.6</priority></url>
</urlset>`;
    
    return new Response(fallbackSitemap, {
      headers: { 'Content-Type': 'application/xml' },
    });
  }
}

const cheerio = require('cheerio');
const https = require('https');

function fetchHTML(url) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const opts = {
      hostname: u.hostname,
      path: u.pathname + u.search,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' }
    };
    https.get(opts, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve(d));
    }).on('error', reject);
  });
}

async function main() {
  // ==================== TOP ANIME ====================
  console.log('=== TOP ANIME ===');
  try {
    let html = await fetchHTML('https://myanimelist.net/topanime.php?limit=0');
    let $ = cheerio.load(html);
    
    // Try different selectors for ranking rows
    let rows = $('tr.ranking-list');
    console.log('ranking-list rows:', rows.length);
    
    if (rows.length === 0) {
      // Fallback - search for common patterns
      rows = $('table.top-ranking-table tr');
      console.log('top-ranking-table rows:', rows.length);
    }
    
    rows.each((i, el) => {
      if (i >= 3) return false;
      console.log('\n--- Row', i, '---');
      console.log('HTML:', $(el).html().substring(0, 200));
    });
  } catch(e) { console.log('Top error:', e.message); }

  // ==================== SEARCH ====================
  console.log('\n=== SEARCH NARUTO ===');
  try {
    let html = await fetchHTML('https://myanimelist.net/anime.php?q=Naruto&cat=anime');
    let $ = cheerio.load(html);
    
    let results = $('.js-anime-category-producer');
    console.log('js-anime-category-producer:', results.length);
    
    if (results.length === 0) {
      results = $('.list-block .list-item');
      console.log('list-item:', results.length);
    }
    
    results.each((i, el) => {
      if (i >= 2) return false;
      console.log('\n--- Search', i, '---');
      console.log('HTML:', $(el).html().substring(0, 300));
    });
  } catch(e) { console.log('Search error:', e.message); }
}

main().catch(e => console.log('ERROR:', e.message));

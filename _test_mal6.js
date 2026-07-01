const cheerio = require('cheerio');
const https = require('https');

function fetchHTML(url) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const opts = {
      hostname: u.hostname,
      path: u.pathname + u.search,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
    };
    https.get(opts, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve(d));
    }).on('error', reject);
  });
}

async function main() {
  // ===== SEARCH PAGE DETAIL =====
  console.log('=== SEARCH PAGE TABLE STRUCTURE ===');
  let html = await fetchHTML('https://myanimelist.net/anime.php?q=Naruto&cat=anime');
  let $ = cheerio.load(html);
  
  // Find the first search result row structure
  let firstLink = $('a.hoverinfo_trigger[href*="/anime/1735/"]').first();
  let row = firstLink.closest('tr');
  console.log('Row HTML sample:', row.html()?.substring(0, 1000));
  
  // Check table structure
  console.log('\nTable tag:', row.parent().prop('tagName'));
  
  // Check columns
  let tds = row.find('td');
  console.log('TDs count:', tds.length);
  tds.each((i, el) => {
    const cls = $(el).attr('class') || '';
    const txt = $(el).text().trim().replace(/\s+/g, ' ').substring(0, 100);
    console.log(`  TD ${i}: class="${cls}" text="${txt}"`);
  });

  // ===== SEASONAL ITEM DETAIL =====
  console.log('\n=== SEASONAL ITEM STRUCTURE ===');
  html = await fetchHTML('https://myanimelist.net/anime/season');
  $ = cheerio.load(html);
  
  let firstSeasonal = $('.js-anime-category-producer').first();
  console.log('Seasonal item HTML:', firstSeasonal.html()?.substring(0, 800));
  
  let classes = firstSeasonal.attr('class');
  console.log('Classes:', classes);
  
  // Check title and score
  let title = firstSeasonal.find('.title, h2, .anime-title').first().text().trim();
  console.log('Title:', title);
  let score = firstSeasonal.find('.score, .js-score').first().text().trim();
  console.log('Score:', score);
  let img = firstSeasonal.find('img').first().attr('data-src') || firstSeasonal.find('img').first().attr('src');
  console.log('Img:', img?.substring(0, 100));
  
  let link = firstSeasonal.find('a').first().attr('href');
  console.log('Link:', link);
}

main().catch(e => console.log('ERROR:', e.message));

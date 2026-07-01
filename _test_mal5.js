const cheerio = require('cheerio');
const https = require('https');

function fetchHTML(url, cookie = '') {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const opts = {
      hostname: u.hostname,
      path: u.pathname + u.search,
      headers: { 
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept-Language': 'en-US,en;q=0.5',
        ...(cookie ? { 'Cookie': cookie } : {})
      }
    };
    https.get(opts, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve(d));
    }).on('error', reject);
  });
}

async function main() {
  const html = await fetchHTML('https://myanimelist.net/anime.php?q=Naruto&cat=anime');
  const $ = cheerio.load(html);
  
  // Find the Naruto Shippuuden link and see its parent structure
  const link = $('a[href*="/anime/1735/"]').first();
  console.log('Link HTML:', link.parent().html()?.substring(0, 500));
  console.log('\nParent tag:', link.parent().prop('tagName'));
  console.log('Grandparent tag:', link.parent().parent().prop('tagName'));
  
  // Find all links with /anime/NUMBER pattern (not /anime/season etc)
  const animeLinks = $('a[href^="https://myanimelist.net/anime/"]').filter(function() {
    const href = $(this).attr('href');
    return /\/anime\/\d+/.test(href) && !href.includes('/anime/season') && !href.includes('/anime/genre') && !href.includes('_location');
  });
  
  console.log('\nAnime detail links:', animeLinks.length);
  animeLinks.each((i, el) => {
    if (i >= 5) return false;
    const href = $(el).attr('href');
    const text = $(el).text().trim();
    const parentDiv = $(el).closest('div').html()?.substring(0, 150);
    console.log(`\n#${i}: ${text}`);
    console.log('  href:', href);
    console.log('  parent context:', parentDiv?.substring(0, 200));
  });
  
  // Also check seasonal page
  console.log('\n\n=== SEASONAL PAGE ===');
  const seasonalHtml = await fetchHTML('https://myanimelist.net/anime/season');
  const $$ = cheerio.load(seasonalHtml);
  
  console.log('div.seasonal-anime:', $$('div.seasonal-anime').length);
  console.log('div.seasonal-anime-item:', $$('div.seasonal-anime-item').length);
  console.log('.js-seasonal-anime:', $$('.js-seasonal-anime').length);
  console.log('.anime-item:', $$('.anime-item').length);
  
  // Check for seasonal anime blocks
  let seasonalItems = $$('.js-anime-category-producer');
  console.log('.js-anime-category-producer:', seasonalItems.length);
  
  // Try finding a seasonal anime container
  let divs = $$('div[class*="seasonal"]');
  console.log('div[class*=seasonal]:', divs.length);
  divs.each((i, el) => {
    if (i >= 3) return false;
    const cls = $$(el).attr('class');
    const h = $$(el).html()?.substring(0, 100);
    console.log(`\nSeasonal div ${i}: class="${cls}"`);
    console.log('  html:', h);
  });
}

main().catch(e => console.log('ERROR:', e.message));

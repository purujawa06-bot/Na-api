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
  // Test 1: Top Anime
  console.log('=== TOP ANIME ===');
  let html = await fetchHTML('https://myanimelist.net/topanime.php?limit=0');
  let $ = cheerio.load(html);
  let rows = $('tr.ranking-list');
  console.log('Rows found:', rows.length);
  rows.each((i, el) => {
    if (i >= 2) return false;
    const rank = $(el).find('td.rank span').text().trim();
    const title = $(el).find('td.title .detail .js-title').text().trim();
    const score = $(el).find('td.score span').text().trim();
    const info = $(el).find('td.title .detail .information').text().trim();
    const img = $(el).find('td.title a img').attr('data-src') || $(el).find('td.title a img').attr('src');
    const link = $(el).find('td.title a').attr('href');
    const malId = link ? link.match(/\/anime\/(\d+)/)?.[1] : null;
    console.log(`#${rank}: ${title} | Score: ${score} | ID: ${malId} | Info: ${info.substring(0,80)}`);
  });

  // Test 2: Seasonal
  console.log('\n=== SEASONAL ===');
  html = await fetchHTML('https://myanimelist.net/anime/season');
  $ = cheerio.load(html);
  let items = $('.seasonal-anime-item, .js-anime-category-producer, .seasonal-anime');
  console.log('Seasonal items found (try 1):', items.length);
  
  // Alternative selectors
  items = $('div[class*="seasonal"]');
  console.log('Seasonal divs:', items.length);
  items.each((i, el) => {
    if (i >= 2) return false;
    const title = $(el).find('p.title, .title, h2, h3').first().text().trim();
    console.log(`Item ${i+1}: "${title}" | class: ${$(el).attr('class')}`);
  });

  // Test 3: Search
  console.log('\n=== SEARCH ===');
  html = await fetchHTML('https://myanimelist.net/anime.php?q=Naruto&cat=anime');
  $ = cheerio.load(html);
  let results = $('.js-anime-category-producer');
  console.log('Search results:', results.length);
  results.each((i, el) => {
    if (i >= 2) return false;
    const title = $(el).find('.title h2 a, .title a, h2 a').first().text().trim();
    const link = $(el).find('a').first().attr('href');
    console.log(`#${i+1}: "${title}" | link: ${link}`);
  });
}

main().catch(e => console.log('ERROR:', e.message, e.stack));

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
  console.log('=== SEARCH NARUTO HTML DUMP ===');
  let html = await fetchHTML('https://myanimelist.net/anime.php?q=Naruto&cat=anime');
  
  // Find where anime list starts
  let startIdx = html.indexOf('search结果');
  if (startIdx === -1) startIdx = html.indexOf('list-block');
  if (startIdx === -1) startIdx = html.indexOf('js-anime');
  if (startIdx === -1) startIdx = html.indexOf('anime-item');
  if (startIdx === -1) startIdx = html.indexOf('anime');
  
  // Print section around anime list
  console.log('Index markers:');
  console.log('search结果:', html.indexOf('search结果'));
  console.log('list-block:', html.indexOf('list-block'));
  console.log('js-anime:', html.indexOf('js-anime'));
  console.log('anime-item:', html.indexOf('anime-item'));
  console.log('div class="anime', html.indexOf('div class="anime'));
  console.log('"anime":', html.indexOf('"anime"'));
  
  // Print HTML content from around the middle where results should be
  let midStart = html.indexOf('Naruto');
  console.log('\nNaruto found at:', midStart);
  if (midStart > -1) {
    console.log('Context:', html.substring(Math.max(0, midStart - 200), midStart + 300));
  }
  
  // Try finding "Naruto" in search results
  let narutoPos = 0;
  let count = 0;
  while ((narutoPos = html.indexOf('Naruto', narutoPos + 1)) !== -1 && count < 3) {
    console.log('\nNaruto context', count, ':', html.substring(Math.max(0,narutoPos-150), narutoPos+150));
    count++;
  }
}

main().catch(e => console.log('ERROR:', e.message));

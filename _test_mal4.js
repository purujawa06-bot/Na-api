const cheerio = require('cheerio');
const https = require('https');

function fetchHTML(url, cookie = '') {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const opts = {
      hostname: u.hostname,
      path: u.pathname + u.search,
      headers: { 
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        ...(cookie ? { 'Cookie': cookie } : {})
      }
    };
    https.get(opts, (res) => {
      let d = '';
      const setCookie = res.headers['set-cookie'];
      res.on('data', c => d += c);
      res.on('end', () => resolve({ html: d, cookie: setCookie }));
    }).on('error', reject);
  });
}

async function main() {
  // First, get a cookie
  console.log('=== FIRST VISIT (get cookies) ===');
  let result = await fetchHTML('https://myanimelist.net/');
  console.log('Cookies received:', result.cookie ? result.cookie[0]?.substring(0,50) : 'none');
  
  const cookieStr = result.cookie ? result.cookie.join('; ') : '';
  
  // Search with cookies
  console.log('\n=== SEARCH WITH COOKIES ===');
  result = await fetchHTML('https://myanimelist.net/anime.php?q=Naruto&cat=anime', cookieStr);
  let html = result.html;
  
  // Check few key areas
  let $ = cheerio.load(html);
  
  // Check div.anime section
  let animeDiv = $('div.anime').first();
  console.log('div.anime length:', $('div.anime').length);
  
  // Check for common search result containers
  let selectors = ['.js-anime-category-producer', '.list-item', '.hoverinfo_trigger', 'article', '.result', '.search-result', '.anime-item', '.anime-list'];
  for (let sel of selectors) {
    console.log(`'${sel}':`, $(sel).length);
  }
  
  // Dump html around where "anime" class appears (position 31345)
  console.log('\n=== HTML around anime area ===');
  const start = html.indexOf('class="anime');
  if (start > -1) {
    console.log(html.substring(Math.max(0,start-100), start+500));
  }
  
  // Also check for any links containing /anime/
  console.log('\n=== Anime links check ===');
  let links = $('a[href*="/anime/"]');
  console.log('Links to /anime/:', links.length);
  links.each((i, el) => {
    if (i >= 3) return false;
    console.log($(el).attr('href'), '->', $(el).text().trim().substring(0,60));
  });
}

main().catch(e => console.log('ERROR:', e.message));

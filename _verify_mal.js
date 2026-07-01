// Quick MAL scraper verification
async function main() {
  // Test 1: Top Anime parsing
  console.log('=== TOP ANIME ===');
  let res = await fetch('https://myanimelist.net/topanime.php?limit=50', {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
  });
  let html = await res.text();
  
  // Manual regex parsing to avoid cheerio dependency
  const rows = html.match(/<tr class="ranking-list">(.*?)<\/tr>/gs);
  console.log('Rows found:', rows?.length);
  
  if (rows && rows[0]) {
    const rank = rows[0].match(/<span[^>]*class="[^"]*top-anime-rank-text[^"]*"[^>]*>(\d+)<\/span>/)?.[1] || '';
    const title = rows[0].match(/class="js-title"[^>]*>(.*?)<\/a>/)?.[1] || '';
    const score = rows[0].match(/<td class="score[^"]*"[^>]*>.*?<span[^>]*>([\d.]+)<\/span>/s)?.[1] || '';
    const img = rows[0].match(/<img[^>]*data-src="([^"]+)"/)?.[1] || '';
    const link = rows[0].match(/<a[^>]*href="(https:\/\/myanimelist\.net\/anime\/\d+[^"]*)"/)?.[1] || '';
    const malId = link.match(/\/anime\/(\d+)/)?.[1] || '';
    console.log(`#${rank}: ${title} | Score: ${score} | ID: ${malId}`);
    console.log('Img:', img.substring(0,80));
  }
  
  // Test 2: Search parsing
  console.log('\n=== SEARCH ===');
  res = await fetch('https://myanimelist.net/anime.php?q=Naruto&cat=anime', {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
  });
  html = await res.text();
  
  // Find the search result table
  const table = html.match(/<table[^>]*width="100%"[^>]*border="0"[^>]*cellpadding="0"[^>]*cellspacing="0"[^>]*>.*?<\/table>/s);
  const searchRows = html.match(/<tr[^>]*>.*?<td[^>]*class="borderClass[^"]*bgColor\d"[^>]*>.*?<a[^>]*href="https:\/\/myanimelist\.net\/anime\/\d+/gs);
  console.log('Search rows (regex):', searchRows?.length);
  
  // Alternative - find all hoverinfo_trigger links
  const animeLinks = [...html.matchAll(/href="(https:\/\/myanimelist\.net\/anime\/(\d+)[^"]*)"/g)];
  const uniqueLinks = [...new Set(animeLinks.map(m => m[1] + '|' + m[2]))];
  console.log('Unique anime links:', uniqueLinks.length);
  uniqueLinks.slice(0,5).forEach(l => {
    const [url, id] = l.split('|');
    console.log(`  ID: ${id}`);
  });
  
  // Test 3: Seasonal
  console.log('\n=== SEASONAL ===');
  res = await fetch('https://myanimelist.net/anime/season', {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
  });
  html = await res.text();
  const seasonalItems = [...html.matchAll(/class="js-anime-category-producer[^"]*"[^>]*>(.*?)<\/div>\s*<\/div>\s*<\/div>/gs)];
  console.log('Seasonal items:', seasonalItems.length);
  if (seasonalItems[0]) {
    const itemHtml = seasonalItems[0][1];
    const titleMatch = itemHtml.match(/<a[^>]*class="link-title"[^>]*>(.*?)<\/a>/);
    console.log('First item title:', titleMatch?.[1] || 'not found');
    const scoreMatch = itemHtml.match(/class="js-score">(\d+)<\/span>/);
    console.log('Score:', scoreMatch?.[1] || '0');
    const imgMatch = itemHtml.match(/<img[^>]*src="([^"]+)"/);
    console.log('Img:', imgMatch?.[1]?.substring(0,80) || 'not found');
  }
  
  // Test 4: Genre page
  console.log('\n=== GENRE ===');
  res = await fetch('https://myanimelist.net/anime/genre/1', {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
  });
  html = await res.text();
  const genreItems = [...html.matchAll(/class="js-anime-category-producer[^"]*"[^>]*>(.*?)<\/div>\s*<\/div>\s*<\/div>/gs)];
  console.log('Genre items:', genreItems.length);
  if (genreItems[0]) {
    const itemHtml = genreItems[0][1];
    const titleMatch = itemHtml.match(/<a[^>]*class="link-title"[^>]*>(.*?)<\/a>/);
    console.log('First item title:', titleMatch?.[1] || 'not found');
  }
}

main().catch(e => console.log('ERROR:', e.message));

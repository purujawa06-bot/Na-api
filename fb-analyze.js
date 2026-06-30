const axios = require('axios');
const url = 'https://www.facebook.com/plugins/video.php?href=https://www.facebook.com/reel/2195585950845288&show_text=0';

async function analyze() {
  const r = await axios.get(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    },
    timeout: 15000
  });
  
  const html = r.data;
  console.log('TOTAL HTML LENGTH:', html.length);
  console.log('=== PATTERN SEARCH ===');
  
  const patterns = [
    'owner_name', 'ownerName', 'owner_id', 'ownerId', 'page_name', 'pageName',
    'page_id', 'profile_name', 'profileName', 'display_name', 'displayName',
    'author_name', 'authorName', 'actor', 'User', 'user_id',
    'title', 'meta property="og:title"', 'meta name="description"',
    'meta property="og:description"', 'meta property="og:image"',
    'json', 'application/ld+json', 'type="application/ld+json"'
  ];
  
  for (const p of patterns) {
    const idx = html.indexOf(p);
    if (idx > -1) {
      const snippet = html.substring(Math.max(0, idx - 50), idx + 200);
      console.log('FOUND:', p, 'at', idx);
      console.log('SNIPPET:', snippet.substring(0, 300));
      console.log('---');
    } else {
      console.log('NOT FOUND:', p);
    }
  }
  
  console.log('=== OWNER JSON BLOBS ===');
  const jsonRegex = /"owner[^}]+}/g;
  let match;
  while ((match = jsonRegex.exec(html)) !== null) {
    console.log('OWNER JSON:', match[0].substring(0, 500));
    console.log('---');
  }
  
  console.log('=== JSON-LD ===');
  const ldIdx = html.indexOf('ld+json');
  if (ldIdx > -1) {
    const start = html.indexOf('>', ldIdx) + 1;
    const end = html.indexOf('</script>', start);
    const jsonld = html.substring(start, end).trim();
    console.log('JSON-LD CONTENT:', jsonld.substring(0, 1500));
  } else {
    console.log('No ld+json found');
  }
  
  // Also search for anything with profile/author/page context
  console.log('=== ACTOR/PROFILE ===');
  const actorRegex = /"actor"[^}]+}/g;
  while ((match = actorRegex.exec(html)) !== null) {
    console.log('ACTOR JSON:', match[0].substring(0, 500));
    console.log('---');
  }
  
  console.log('=== ALL META TAGS ===');
  const metaRegex = /<meta[^>]+>/g;
  while ((match = metaRegex.exec(html)) !== null) {
    if (match[0].includes('og:') || match[0].includes('description') || match[0].includes('title')) {
      console.log('META:', match[0]);
    }
  }
}

analyze().catch(e => console.error('ERROR:', e.message));

// Fetch raw HTML of topanime page
const https = require('https');
const opts = {
  hostname: 'myanimelist.net',
  path: '/topanime.php?limit=0',
  headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
};
https.get(opts, (res) => {
  let d = '';
  res.on('data', c => d += c);
  res.on('end', () => {
    // Print first 4000 chars of HTML to understand structure
    console.log(d.substring(0, 4000));
  });
}).on('error', e => console.log('Error:', e.message));

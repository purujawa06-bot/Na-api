process.env.NODE_PATH = '/root/.picoclaw/workspace/scraper-collection/node_modules';
require('module').Module._initPaths();

const axios = require('axios');

axios.get('https://api.instagram.com/oembed?url=https://www.instagram.com/reel/DV5hrHUEg4U/', {
  headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
  timeout: 10000
}).then(r => console.log(JSON.stringify(r.data, null, 2)))
.catch(e => console.error('ERROR:', e.message, e.response?.status));

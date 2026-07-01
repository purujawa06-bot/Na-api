const { scrapeInstagram } = require('./lib/instagram');

scrapeInstagram('https://www.instagram.com/reel/DV5hrHUEg4U/')
  .then(r => console.log(JSON.stringify(r, null, 2)))
  .catch(e => console.error('ERROR:', e.message));

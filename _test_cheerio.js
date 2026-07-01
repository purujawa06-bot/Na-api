const cheerio = require('cheerio');
const $ = cheerio.load('<div class="test">hello world</div>');
console.log('Text:', $('.test').text());
console.log('Version:', cheerio.version);
console.log('load type:', typeof cheerio.load);

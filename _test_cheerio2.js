const c = require('cheerio');
console.log('Type:', typeof c.load);
const $ = c.load('<div>test</div>');
console.log('Text:', $('div').text());

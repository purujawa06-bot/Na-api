// Self-contained test for fbdown
// Uses dynamic require with fallback

async function run() {
  try {
    const { fbdown } = require('./lib/fbdown');
    
    console.log('=== TEST: Facebook Reel ===');
    const result = await fbdown('https://www.facebook.com/reel/2195585950845288', {
      includeThumbnail: true,
      includeSubtitles: true
    });
    
    console.log('\n=== RESULTS ===');
    console.log('ID:', result.id);
    console.log('Owner:', JSON.stringify(result.owner, null, 2));
    console.log('Description:', result.description);
    console.log('HD Video:', result.video.hd ? '✅ ' + result.video.hd.substring(0, 80) + '...' : '❌');
    console.log('SD Video:', result.video.sd ? '✅ ' + result.video.sd.substring(0, 80) + '...' : '❌');
    console.log('Duration:', result.duration, 's');
    console.log('Dimensions:', result.width, 'x', result.height);
    console.log('Thumbnail:', result.thumbnail ? '✅' : '❌');
    console.log('Subtitles:', result.subtitles ? '✅' : '❌');
    console.log('Formats:', result.formats.length);
    if (result.formats.length > 0) {
      console.log('First format:', JSON.stringify(result.formats[0]));
    }
  } catch(e) {
    console.error('FAILED:', e.message);
    if (e.stack) console.error(e.stack.substring(0, 500));
  }
}

run();

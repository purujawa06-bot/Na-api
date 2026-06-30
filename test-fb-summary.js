const { fbdown } = require('./lib/fbdown');

async function test() {
  try {
    console.log('=== TEST: Facebook Reel ===');
    const result = await fbdown('https://www.facebook.com/reel/2195585950845288', {
      includeThumbnail: true,
      includeSubtitles: true
    });
    // Summarize
    console.log('ID:', result.id);
    console.log('URL:', result.url);
    console.log('HD Video:', result.video.hd ? 'OK (' + result.video.hd.length + ' chars)' : null);
    console.log('SD Video:', result.video.sd ? 'OK (' + result.video.sd.length + ' chars)' : null);
    console.log('Owner:', JSON.stringify(result.owner));
    console.log('Description:', result.description);
    console.log('Width x Height:', result.width + 'x' + result.height);
    console.log('Aspect Ratio:', result.aspectRatio);
    console.log('Duration:', result.duration, 'seconds');
    console.log('Subtitles:', result.subtitles ? 'OK (' + result.subtitles.length + ' chars)' : null);
    console.log('Thumbnail:', result.thumbnail ? 'OK (' + result.thumbnail.length + ' chars)' : null);
    console.log('Formats count:', result.formats.length);
    result.formats.forEach(f => {
      console.log('  ' + f.label + ' (' + f.qualityClass + '): ' + f.width + 'x' + f.height + ' @ ' + f.bandwidth + 'bps');
    });
    console.log('\n=== FULL RESULT ===');
    console.log(JSON.stringify(result, null, 2));
  } catch (e) {
    console.error('ERROR:', e.message);
    if (e.response) console.error('Status:', e.response.status);
  }
}
test();

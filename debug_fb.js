const axios = require('axios');

const urls = [
  { label: 'URL1 share/v/', url: 'https://www.facebook.com/share/v/1YjnnvAi29/' },
  { label: 'URL3 reel/341057...', url: 'https://www.facebook.com/reel/3410573959120345/' }
];

async function debug() {
  for (const item of urls) {
    console.log(`\n========== ${item.label} ==========`);
    console.log(`URL: ${item.url}`);
    
    const embedUrl = `https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(item.url)}&show_text=0`;
    
    try {
      const response = await axios.get(embedUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
        timeout: 30000,
      });
      
      const html = response.data;
      console.log(`HTML length: ${html.length} bytes`);
      console.log(`Has hd_src: ${html.includes('hd_src')}`);
      console.log(`Has sd_src: ${html.includes('sd_src')}`);
      console.log(`Has dash_manifest: ${html.includes('dash_manifest')}`);
      console.log(`Has <video: ${html.includes('<video')}`);
      console.log(`Has BaseURL: ${html.includes('BaseURL')}`);
      console.log(`Has video src=: ${html.includes('src=')}`);
      console.log(`Has video data-src: ${html.includes('data-src')}`);
      console.log(`Has video srcset: ${html.includes('srcset')}`);
      console.log(`Has fbclid: ${html.includes('fbclid')}`);
      console.log(`Has login: ${html.includes('login')}`);
      console.log(`Has redirect: ${html.includes('redirect')}`);
      console.log(`Has error: ${html.includes('error')}`);
      console.log(`Has content: ${html.includes('content')}`);
      console.log(`Has meta: ${html.includes('<meta')}`);
      console.log(`\nFirst 1000 chars:\n${html.substring(0, 1000)}`);
      console.log(`\nLast 1000 chars:\n${html.substring(html.length - 1000)}`);
    } catch (e) {
      console.log(`Error: ${e.message}`);
    }
  }
}

debug().catch(console.error);

// Probe savefrom.co.id: apakah engine-nya = vidssave contentsite_api?
// Grep semua chunk JS halaman untuk pola auth/domain/api yang dikenal.
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const PAGE = 'https://savefrom.co.id/youtube-video-downloader';

const res = await fetch(PAGE, { headers: { 'user-agent': UA } });
const h = await res.text();

const scripts = [...h.matchAll(/<script[^>]*src="([^"]+)"[^>]*>/g)].map(m => m[1]);
console.log('SCRIPTS:', scripts);

for (const src of scripts) {
  const url = src.startsWith('http') ? src : new URL(src, 'https://savefrom.co.id').href;
  let js;
  try {
    js = await (await fetch(url, { headers: { 'user-agent': UA } })).text();
  } catch (e) {
    console.log(`!! gagal fetch ${url}: ${e.message}`);
    continue;
  }
  console.log(`\n===== ${url} (${js.length} bytes) =====`);

  // pola kunci ala vidssave
  for (const pat of [/auth[=:]\s*["'][0-9]{8}[a-z]+["']/gi, /domain[=:]\s*["'][^"']+["']/gi,
                     /contentsite_api/gi, /https?:\/\/api\.[a-z0-9.-]+/gi, /\/api\/[a-z_\/]{3,40}/gi]) {
    const hits = [...new Set([...js.matchAll(pat)].map(m => m[0]))];
    if (hits.length) console.log('  HIT', pat.source.slice(0, 30), '=>', hits.slice(0, 15));
  }
}

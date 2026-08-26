// Probe savefrom.co.id: cari form/script/endpoint dari HTML halaman youtube downloader
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36';

const res = await fetch('https://savefrom.co.id/youtube-video-downloader', {
  headers: { 'user-agent': UA, 'accept': 'text/html' },
});
const h = await res.text();
console.log('STATUS', res.status, 'LEN', h.length);
console.log('COOKIES:', res.headers.getSetCookie?.() ?? []);

const scripts = [...h.matchAll(/<script[^>]*src="([^"]+)"[^>]*>/g)].map(m => m[1]);
console.log('SCRIPTS:', JSON.stringify(scripts, null, 1));

const forms = [...h.matchAll(/<form[^>]*>/g)].map(m => m[0]);
console.log('FORMS:', forms);

const inputs = [...h.matchAll(/<(input|textarea|button)[^>]*>/g)].map(m => m[0]);
console.log('INPUTS:\n' + inputs.join('\n'));

const inline = [...h.matchAll(/<script(?![^>]*src)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
console.log('INLINE COUNT:', inline.length);
inline.forEach((s, i) => {
  console.log(`---INLINE ${i} len=${s.length}---`);
  console.log(s.slice(0, 1500));
});

// Tes penentu: apakah savefrom.co.id /api/convert menerima body polos (tanpa signature)?
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const BASE = 'https://savefrom.co.id';
const YT = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';

// 1. GET halaman -> cookies (XSRF-TOKEN + session)
const page = await fetch(`${BASE}/youtube-video-downloader`, { headers: { 'user-agent': UA } });
const cookies = page.headers.getSetCookie();
const jar = cookies.map(c => c.split(';')[0]).join('; ');
const xsrf = decodeURIComponent((cookies.find(c => c.startsWith('XSRF-TOKEN=')) || '').split(';')[0].replace('XSRF-TOKEN=', ''));
console.log('cookies:', jar.slice(0, 80) + '...');
console.log('xsrf len:', xsrf.length);

async function tryConvert(label, bodyObj, extraHeaders = {}) {
  const res = await fetch(`${BASE}/api/convert`, {
    method: 'POST',
    headers: {
      'user-agent': UA,
      'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'x-requested-with': 'XMLHttpRequest',
      'x-xsrf-token': xsrf,
      cookie: jar,
      origin: BASE,
      referer: `${BASE}/youtube-video-downloader`,
      ...extraHeaders,
    },
    body: new URLSearchParams(bodyObj),
  });
  const text = await res.text();
  console.log(`\n[${label}] HTTP ${res.status}: ${text.slice(0, 300)}`);
  return text;
}

// 2a. body polos ala form
await tryConvert('polos {url}', { url: YT });

// 2b. dengan _token Laravel (ala form POST biasa)
await tryConvert('{_token,url}', { _token: xsrf, url: YT });

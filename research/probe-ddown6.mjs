// Uji alur popup ddown.to + definisi subscribeSignedRequestBody
const YT = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// 1) definisi subscribeSignedRequestBody di bundle
const rjs = await fetch('https://ddown.to/js/app.js?id=32fb09d6cd6543946e351c17d764b58b', {
  headers: { 'User-Agent': UA },
  signal: AbortSignal.timeout(20000),
});
const js = await rjs.text();
for (const kw of ['subscribeSignedRequestBody=function', '"subscribeSignedRequestBody"', 'key:"subscribeSignedRequestBody"', '/api/subscribe', 'signed']) {
  let i = js.indexOf(kw);
  if (i >= 0) console.log(`DEF[${kw}] @${i}:`, js.slice(Math.max(0, i - 100), i + 600).replace(/\s+/g, ' '), '\n');
}

// 2) kandidat endpoint popup
for (const u of [
  `https://ddown.to/id/?url=${encodeURIComponent(YT)}&popup=true`,
  `https://ddown.to/?url=${encodeURIComponent(YT)}&popup=true`,
  `https://ddown.to/id/video?url=${encodeURIComponent(YT)}&popup=true`,
]) {
  try {
    const r = await fetch(u, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15000) });
    const t = await r.text();
    console.log('POPUP', r.status, u.slice(0, 60), '=>', t.slice(0, 200).replace(/\s+/g, ' '));
    if (t.includes('taskId')) break;
  } catch (e) {
    console.log('POPUP FAIL', u.slice(0, 50), e.cause?.code || e.message);
  }
}

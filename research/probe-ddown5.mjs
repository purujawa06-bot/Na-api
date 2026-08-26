// Cari definisi subscribeSignedRequestBody & pemakaian send-form di app.js ddown.to
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131';
const r = await fetch('https://ddown.to/js/app.js?id=32fb09d6cd6543946e351c17d764b58b', {
  headers: { 'User-Agent': UA },
  signal: AbortSignal.timeout(20000),
});
const js = await r.text();

function ctx(kw, span = 500, max = 3) {
  let i = 0,
    n = 0;
  while ((i = js.indexOf(kw, i)) >= 0 && n < max) {
    console.log(`\n=== ${kw} @${i} ===\n`, js.slice(Math.max(0, i - span), i + span).replace(/\s+/g, ' '));
    i += kw.length;
    n++;
  }
}
ctx('subscribeSignedRequestBody:', 700, 2);
ctx('subscribeSignedRequestBody(', 300, 2);
ctx('/api/send-form', 400);
ctx('/api/convert', 250, 2);
ctx('/tasks/', 300, 3);

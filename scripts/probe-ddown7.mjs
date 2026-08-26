// Peta lengkap API ddown.to dari bundle: semua St.post/get + signed request
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131';
const r = await fetch('https://ddown.to/js/app.js?id=32fb09d6cd6543946e351c17d764b58b', {
  headers: { 'User-Agent': UA },
  signal: AbortSignal.timeout(20000),
});
const js = await r.text();

// 1) semua pemakaian St.<http-method>("<path>")
console.log('== AXIOS CALLS ==');
for (const m of js.matchAll(/St\.(post|get|put)\("([^"]+)"/g)) console.log(`${m[1].toUpperCase()} ${m[2]}`);

// 2) semua fetch("...")
console.log('\n== FETCH CALLS ==');
for (const m of js.matchAll(/fetch\("([^"]+)"/g)) console.log(m[1]);

// 3) konteks definisi subscribeSignedRequestBody (case-insensitive)
console.log('\n== SIGNED REQUEST ==');
const low = js.toLowerCase();
let i = low.indexOf('subscribesignedrequestbody');
while (i >= 0) {
  const around = js.slice(Math.max(0, i - 60), i + 40);
  console.log(`@${i}: ...${around.replace(/\s+/g, ' ')}...`);
  i = low.indexOf('subscribesignedrequestbody', i + 1);
}

// 4) cari endpoint yang mengandung sign/subscribe/worker
console.log('\n== SIGN/WORKER ENDPOINTS ==');
for (const m of js.matchAll(/["'](\/[^"']*(?:sign|subscribe|worker|hub)[^"']*)["']/gi))
  console.log(m[1]);
for (const m of js.matchAll(/["']([^"']*worker[-_]?hub[^"']*)["']/gi)) console.log('WH:', m[1].slice(0, 120));

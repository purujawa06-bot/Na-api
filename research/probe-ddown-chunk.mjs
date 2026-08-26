// Ambil chunk webpack 909 ddown.to (modul signing /api/convert)
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131';
const APP = 'https://ddown.to/js/app.js?id=32fb09d6cd6543946e351c17d764b58b';
const r = await fetch(APP, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20000) });
const js = await r.text();

// cari peta hash chunk: n.u=e=>... biasanya "static/js/"+e+"."+{...}[e]+".js"
let chunkUrl = null;
for (const m of js.matchAll(/\.u=\(?e\)?=>"([^"]*)"\+"?"?\.?\+?\(?[^;]{0,500}/g)) {
  console.log('U-TEMPLATE:', m[0].slice(0, 300), '\n');
}
// fallback: cari langsung "909":"
for (const m of js.matchAll(/"909":\s*"([^"]+)"/g)) {
  console.log('HASH 909:', m[1]);
  chunkUrl = `https://ddown.to/js/${m[1]}.js`;
}
if (!chunkUrl) {
  // coba pola path lain
  for (const m of js.matchAll(/"(\d+)":\s*"([a-f0-9]{8,})"/g)) console.log('MAP', m[1], '=', m[2]);
  process.exit(1);
}
console.log('URL:', chunkUrl);
const rc = await fetch(chunkUrl, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20000) });
if (!rc.ok) {
  console.log('HTTP', rc.status);
  process.exit(1);
}
const code = await rc.text();
console.log('LEN:', code.length);
console.log(code.slice(0, 6000));

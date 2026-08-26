// Cari via DDG/Bing tanpa browser. Jalankan: node scripts/search-plain.mjs "query"
const q = process.argv.slice(2).join(' ');
const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131' };

try {
  const r = await fetch('https://html.duckduckgo.com/html/?q=' + encodeURIComponent(q), {
    headers: UA,
    signal: AbortSignal.timeout(15000),
  });
  const t = await r.text();
  console.log('=== ddg', r.status, 'len', t.length);
  const re = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  let m,
    i = 0;
  while ((m = re.exec(t)) && i < 10) {
    i++;
    let url = m[1];
    if (url.startsWith('//duckduckgo.com/l/?uddg=')) url = decodeURIComponent(url.split('uddg=')[1].split('&')[0]);
    console.log(`${i}. ${m[2].replace(/<[^>]+>/g, '').trim()}\n   ${url}`);
  }
  if (!i) console.log(t.slice(0, 300));
} catch (e) {
  console.log('=== ddg FAIL', e.cause?.code || e.message);
}

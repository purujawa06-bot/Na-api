// Ekstrak endpoint dari bundle JS ddown.to
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131';
const r = await fetch('https://ddown.to/js/app.js?id=32fb09d6cd6543946e351c17d764b58b', {
  headers: { 'User-Agent': UA },
  signal: AbortSignal.timeout(20000),
});
const js = await r.text();
console.log('len', js.length);

const urls = new Set();
for (const m of js.matchAll(/https?:\/\/[a-z0-9.-]+\.[a-z]{2,}[^"'\s`\\)]*/gi)) urls.add(m[0].slice(0, 100));
for (const m of js.matchAll(/["'`](\/(?:ajax|api|download|convert|job|task|check)[^"'`\s]*)["'`]/gi))
  urls.add('PATH:' + m[1]);
const interesting = [...urls].filter((u) => !/w3\.org|schema|googleapis|gtag|googletagmanager|font|npmjs|github\.com\/(facebook|vuejs)|localhost/i.test(u));
console.log(interesting.join('\n'));

// konteks sekitar kata ajax/download
for (const kw of ['ajax', '/api/', 'oceansaver', 'download.php']) {
  let idx = js.indexOf(kw);
  if (idx >= 0) console.log(`\nCTX[${kw}]:`, js.slice(Math.max(0, idx - 120), idx + 180).replace(/\s+/g, ' '));
}

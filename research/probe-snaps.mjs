// Probe generik snapscooper.com/id/tools/yt1: identifikasi engine dari chunk JS
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const PAGE = 'https://snapscooper.com/id/tools/yt1';

const res = await fetch(PAGE, { headers: { 'user-agent': UA } });
const h = await res.text();
console.log('STATUS', res.status, 'LEN', h.length);
console.log('COOKIES:', (res.headers.getSetCookie?.() ?? []).map(c => c.split('=')[0]));

const scripts = [...h.matchAll(/<script[^>]*src="([^"]+)"[^>]*>/g)].map(m => m[1]);
console.log('SCRIPTS:', scripts);

const forms = [...h.matchAll(/<form[^>]*>/g)].map(m => m[0]);
console.log('FORMS:', forms);

for (const src of scripts) {
  const url = src.startsWith('http') ? src : new URL(src, PAGE).href;
  let js;
  try {
    js = await (await fetch(url, { headers: { 'user-agent': UA } })).text();
  } catch (e) {
    console.log(`!! gagal fetch ${url}: ${e.message}`);
    continue;
  }
  console.log(`\n===== ${url} (${js.length} bytes) =====`);
  const pats = [
    [/contentsite_api/gi, 'vidssave-engine'],
    [/auth[=:]\s*["'][0-9]{8}[a-z]+["']/gi, 'vidssave-auth'],
    [/\/api\/convert/gi, 'ddown-family'],
    [/https?:\/\/[a-z0-9.-]*api[a-z0-9.-]*\.[a-z]{2,}[^\s"']*/gi, 'api-host'],
    [/(?:fetch|axios|post)\s*\(\s*["'`]([^"'`]{5,80})["'`]/gi, 'fetch-call'],
    [/["'](https?:\/\/[^"']{10,100})["']/gi, 'urls'],
  ];
  for (const [pat, label] of pats) {
    const hits = [...new Set([...js.matchAll(pat)].map(m => m[2] ?? m[1] ?? m[0]))];
    if (hits.length) console.log(`  [${label}]`, hits.slice(0, 20));
  }
}

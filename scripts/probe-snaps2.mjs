// Probe snapscooper ronde 2: grepi chunk SvelteKit untuk endpoint API
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const PAGE = 'https://snapscooper.com/id/tools/yt1';

const res = await fetch(PAGE, { headers: { 'user-agent': UA } });
let h = await res.text();

// semua path _app/immutable di HTML (termasuk dalam data sveltekit)
let urls = [...new Set([...h.matchAll(/\/_app\/immutable\/[^\s"'<>]+?\.(?:js|mjs)/g)].map(m => m[0]))];
console.log('CHUNK DI HTML:', urls.length);

// inline module scripts juga
for (const m of h.matchAll(/<script[^>]*type="module"[^>]*>([\s\S]*?)<\/script>/g)) {
  const inner = [...m[1].matchAll(/\/_app\/immutable\/[^\s"'<>]+?\.js/g)].map(x => x[0]);
  urls.push(...inner);
}
urls = [...new Set(urls)];
console.log('TOTAL CHUNK:', urls.length);

// grepi tiap chunk
const found = new Map();
for (const p of urls) {
  let js;
  try {
    js = await (await fetch(new URL(p, PAGE), { headers: { 'user-agent': UA } })).text();
  } catch { continue; }
  const pats = [
    [/["'](https?:\/\/[^"']{8,120})["']/g, 'url'],
    [/["'](\/api\/[^"']{2,80})["']/g, 'path'],
    [/["'](\/[a-z0-9_-]+\/api\/[^"']{2,60})["']/gi, 'path2'],
    [/contentsite_api|analyze|convert|download[_-]?(?:link|query)|task[_-]?id/gi, 'kata'],
  ];
  for (const [pat, label] of pats) {
    for (const m of js.matchAll(pat)) {
      const v = m[1] ?? m[0];
      if (!found.has(v)) found.set(v, [label, p.split('/').pop()]);
    }
  }
}

// saring noise umum
const NOISE = /(google|cloudflare|schema\.org|w3\.org|font|adservice|doubleclick|facebook|apple|twitter|github|youtube\.com\/(embed|iframe)|svelte|vercel|unsplash|pexels|svg|png|jpg|webp|ico|css|mailto|cdn\.)/i;
for (const [v, [label, src]] of found) {
  if (/^url$|^path/.test(label) && NOISE.test(v)) continue;
  console.log(`[${label}] ${v}   <-- ${src}`);
}

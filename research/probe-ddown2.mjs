// Bedah form & endpoint ddown.to
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131';
const r = await fetch('https://ddown.to/id/', { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15000) });
const h = await r.text();
console.log('len', h.length);
for (const f of h.matchAll(/<form[\s\S]*?<\/form>/g)) console.log('FORM:', f[0].replace(/\s+/g, ' ').slice(0, 300));
for (const m of h.matchAll(/<script[^>]*src="([^"]+)"/g)) console.log('SCRIPT:', m[1]);
for (const m of h.matchAll(/(?:fetch\(|url\s*:\s*|action\s*=\s*["'])(\/[^"'\s]+|https:\/\/[^"'\s]+)/g))
  console.log('EP:', m[1]);
// potongan skrip inline yang menyebut ajax/api/download
for (const m of h.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)) {
  const s = m[1];
  if (/ajax|api|download/i.test(s)) console.log('INLINE:', s.replace(/\s+/g, ' ').slice(0, 700));
}

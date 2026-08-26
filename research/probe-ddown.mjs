// Probe alur ddown.to murni HTTP. Jalankan: node scripts/probe-ddown.mjs
const YT = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const r1 = await fetch('https://ddown.to/id/', {
  headers: { 'User-Agent': UA },
  signal: AbortSignal.timeout(15000),
});
const cookies = r1.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
const html = await r1.text();
console.log('[1] GET', r1.status, 'cookie:', cookies.slice(0, 80) || '(kosong)');

const token =
  html.match(/<input[^>]*name="_token"[^>]*value="([^"]+)"/)?.[1] ||
  html.match(/<meta[^>]*name="csrf-token"[^>]*content="([^"]+)"/)?.[1];
console.log('[1] _token:', token ? token.slice(0, 30) + '...' : 'TIDAK ADA');

if (!token) {
  console.log(html.slice(0, 600));
  process.exit(1);
}

await new Promise((r) => setTimeout(r, 1000));
const r2 = await fetch('https://ddown.to/id/', {
  method: 'POST',
  headers: {
    'User-Agent': UA,
    'Content-Type': 'application/x-www-form-urlencoded',
    Cookie: cookies,
    Referer: 'https://ddown.to/id/',
    Origin: 'https://ddown.to',
  },
  body: new URLSearchParams({ _token: token, url: YT }),
  redirect: 'follow',
  signal: AbortSignal.timeout(30000),
});
const html2 = await r2.text();
console.log('[2] POST', r2.status, r2.url, 'len', html2.length);

// cari petunjuk: link unduhan, ajax, json, task id
for (const re of [
  /https?:\/\/[^"'\s<>]*(?:download|dl|media|googlevideo|oceansaver|ajax)[^"'\s<>]*/gi,
  /(?:task_id|job_id|video_id|"id")\s*[:=]\s*["'][^"']{4,40}/gi,
]) {
  const hits = [...new Set(html2.match(re) || [])].slice(0, 8);
  console.log('[2] pola', re.source.slice(0, 40), '=>', JSON.stringify(hits, null, 1).slice(0, 800));
}
console.log('[2] snippet:', html2.replace(/\s+/g, ' ').slice(0, 500));

// Alur lengkap ddown.to: token -> POST /api/convert -> poll /tasks/
const YT = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const BASE = 'https://ddown.to';

const r1 = await fetch(`${BASE}/id/`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15000) });
const setc = r1.headers.getSetCookie().map((c) => c.split(';')[0]);
const cookie = setc.join('; ');
const xsrf = decodeURIComponent(setc.find((c) => c.startsWith('XSRF-TOKEN='))?.split('=').slice(1).join('=') || '');
const html = await r1.text();
const token = html.match(/<input[^>]*name="_token"[^>]*value="([^"]+)"/)?.[1];
console.log('[1] cookie ok:', !!cookie, '| _token:', !!token);

async function post(path, params) {
  return fetch(BASE + path, {
    method: 'POST',
    headers: {
      'User-Agent': UA,
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      Cookie: cookie,
      Referer: `${BASE}/id/`,
      Origin: BASE,
      'X-Requested-With': 'XMLHttpRequest',
      ...(xsrf ? { 'X-XSRF-TOKEN': xsrf } : {}),
    },
    body: new URLSearchParams(params),
    signal: AbortSignal.timeout(50000),
  });
}

let res = await post('/api/convert', { _token: token, url: YT });
let txt = await res.text();
console.log('[2] /api/convert', res.status, txt.slice(0, 300));

// kalau minta field tambahan, coba baca petunjuk dari respons
if (res.status !== 200 || !txt.includes('#json#')) process.exit(1);

let payload;
try {
  payload = JSON.parse(txt.replace(/^#json#/, '').replace(/#json#$/, ''));
} catch (e) {
  console.log('parse gagal:', e.message);
  process.exit(1);
}
console.log('[2] payload:', JSON.stringify(payload).slice(0, 600));

// poll tasks
const tid = payload.id || payload.task_id || payload.taskId;
if (tid) {
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 4000));
    const rt = await fetch(`${BASE}/tasks/${tid}`, {
      headers: { 'User-Agent': UA, Cookie: cookie, Referer: `${BASE}/id/`, 'X-Requested-With': 'XMLHttpRequest' },
      signal: AbortSignal.timeout(20000),
    });
    const tt = await rt.text();
    console.log(`[3] poll#${i}`, rt.status, tt.slice(0, 250));
    if (tt.includes('http') && /download|url/i.test(tt)) break;
  }
}

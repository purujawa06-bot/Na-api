import { uploadFile } from '../lib/deepseek-chat.js';

const token = 'BOMT3jOBVI3WW3+fDmFgPlXROV1G1ynFekRDrjHvrhcuqA87NrYasKkK6g4A3Vq0';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36';

async function download(url) {
  const res = await fetch(url, { headers: { 'user-agent': UA } });
  const buf = Buffer.from(await res.arrayBuffer());
  const ct = res.headers.get('content-type')?.split(';')[0] || '';
  return { buf, ct, status: res.status };
}

const trials = [
  { url: 'https://httpbin.org/image/png', name: 'a.png', contentType: 'image/png' },
  { url: 'https://httpbin.org/image/png', name: 'b.jpeg', contentType: 'image/jpeg' },
  { url: 'https://httpbin.org/image/png', name: 'img', contentType: 'image/png' },
];

for (const t of trials) {
  try {
    const { buf, ct } = await download(t.url);
    console.log(`\n=== trial name=${t.name} ct=${t.contentType} (dl ct=${ct}, len=${buf.length}) ===`);
    try {
      const r = await uploadFile(token, buf, t.name, t.contentType);
      console.log('OK:', JSON.stringify(r));
    } catch (e) {
      console.log('ERR:', e.message);
    }
  } catch (e) {
    console.log('DL ERR:', e.message);
  }
}

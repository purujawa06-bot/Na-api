const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const API = 'https://api.vidssave.com/api/contentsite_api';
const AUTH = '20250901majwlqo';
const DOMAIN = 'api-ak.vidssave.com';

const headers = {
  'Content-Type': 'application/x-www-form-urlencoded',
  Origin: 'https://id.vidssave.com',
  Referer: 'https://id.vidssave.com/',
  'User-Agent': UA
};

async function main() {
  // 1) parse
  const pBody = new URLSearchParams({ auth: AUTH, domain: DOMAIN, origin: 'source', link: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' });
  const pRes = await fetch(`${API}/media/parse`, { method: 'POST', headers, body: pBody });
  const pJson = await pRes.json();
  if (pJson.status !== 1) throw new Error('parse gagal: ' + JSON.stringify(pJson).substring(0, 300));

  const { title, resources } = pJson.data;
  console.log('title:', title);
  console.log('jumlah resource:', resources.length);
  const pick = resources.find(r => r.quality === '360P' && r.type === 'video') || resources[0];
  console.log('pilih:', pick.quality, pick.format, pick.type, 'id=', pick.resource_id);

  // 2) mulai task download
  const dBody = new URLSearchParams({ auth: AUTH, domain: DOMAIN, request: pick.resource_id, no_encrypt: '1' });
  const dRes = await fetch(`${API}/media/download`, { method: 'POST', headers, body: dBody });
  const dJson = await dRes.json();
  console.log('\nmedia/download:', JSON.stringify(dJson));
  if (dJson.status !== 1) throw new Error('download start gagal');
  const taskId = dJson.data.task_id;
  console.log('task_id:', taskId);

  // 3) poll media/download_query (GET)
  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 2000));
    const qUrl = `${API}/media/download_query?auth=${AUTH}&domain=${DOMAIN}&task_id=${encodeURIComponent(taskId)}`;
    const qRes = await fetch(qUrl, { headers: { Referer: 'https://id.vidssave.com/', 'User-Agent': UA } });
    const qJson = await qRes.json();
    console.log(`poll #${i + 1}:`, JSON.stringify(qJson).substring(0, 400));
    if (qJson.status === 1 && qJson.data?.download_url) {
      console.log('\n=== SUKSES ===');
      console.log('download_url:', qJson.data.download_url.substring(0, 150));
      return;
    }
    if (qJson.status !== 1 && qJson.status !== 0) break;
  }
}

main().catch(e => console.error('ERROR:', e.message));
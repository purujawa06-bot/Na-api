import WebSocket from 'ws';

async function main() {
  const res = await fetch('http://127.0.0.1:9222/json');
  const targets = await res.json();
  const target = targets.find(t => t.url.includes('vidssave.com') || t.type === 'page');

  if (!target) {
    console.error('Target tab not found!');
    return;
  }

  console.log('Connecting to target:', target.url);
  const ws = new WebSocket(target.webSocketDebuggerUrl);

  ws.on('open', () => {
    ws.send(JSON.stringify({ id: 1, method: 'Network.enable' }));
  });

  ws.on('message', (data) => {
    const msg = JSON.parse(data.toString());
    if (msg.method === 'Network.requestWillBeSent') {
      const { request } = msg.params;
      if (request.url.includes('/api') || request.url.includes('api') || request.method === 'POST') {
        console.log('\n--- REQUEST ---');
        console.log('URL:', request.url);
        console.log('Method:', request.method);
        console.log('Headers:', JSON.stringify(request.headers, null, 2));
        if (request.postData) console.log('PostData:', request.postData);
      }
    }
  });
}

main().catch(console.error);
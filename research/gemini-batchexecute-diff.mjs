#!/usr/bin/env node
const CDP_HTTP = 'http://127.0.0.1:9222';
const BASE = 'https://gemini.google.com';
function sleep(ms){return new Promise(r=>setTimeout(r,ms));}
function extractRaw(ev){ if(typeof ev==='string')return ev; if(ev&&typeof ev.data==='string')return ev.data; if(ev&&ev.data!==undefined&&ev.data!==null)return String(ev.data); return String(ev);}
const targets = await fetch(`${CDP_HTTP}/json/list`).then(r=>r.json());
let page = targets.find(t=>t.type==='page'&&t.url.includes('gemini.google.com')&&t.webSocketDebuggerUrl);
if(!page){ console.log('buat tab baru...'); page = await fetch(`${CDP_HTTP}/json/new?url=${encodeURIComponent(BASE+'/app')}`,{method:'PUT'}).then(r=>r.json()); }
if(!page.webSocketDebuggerUrl){ console.log('NO WS URL'); console.log(targets.map(t=>t.url+' '+t.type).slice(0,8)); process.exit(1); }
await fetch(`${CDP_HTTP}/json/activate/${page.id}`).catch(()=>{});
const ws = new WebSocket(page.webSocketDebuggerUrl);
ws._listeners = new Set();
ws.onmessage = (ev)=>{ const raw=extractRaw(ev); for(const fn of ws._listeners) fn(raw); };
await new Promise(res=>{ ws.addEventListener('open',res); });
async function cmd(method,params={}){const id=Math.floor(Math.random()*1e6)+1;return new Promise((res,rej)=>{const fn=(raw)=>{const m=JSON.parse(raw);if(m.id===id){ws._listeners.delete(fn);m.error?rej(new Error(m.error.message)):res(m.result);}};ws._listeners.add(fn);ws.send(JSON.stringify({id,method,params}));});}
const ev=(expr)=>cmd('Runtime.evaluate',{expression:expr,returnByValue:true,awaitPromise:true}).then(r=>r.result?.value);
await cmd('Network.enable'); await cmd('Runtime.enable'); await cmd('Page.enable');
await cmd('Emulation.setDeviceMetricsOverride',{width:412,height:915,deviceScaleFactor:2,mobile:true});
await cmd('Page.navigate',{url:BASE+'/app'});
await sleep(8000);

const results = {};
for (const model of ['3.6 Flash', '3.1 Pro']) {
  console.log('=== switch ' + model + ' ===');
  let l5 = null;
  const handler = (raw)=>{try{const m=JSON.parse(raw);if(m.method==='Network.requestWillBeSent'&&m.params.request.url.includes('L5adhe')&&m.params.request.postData){l5=m.params.request.postData;}}catch{}};
  ws._listeners.add(handler);
  await ev(`(()=>{const b=document.querySelector('bard-mode-switcher button, .gds-mode-switch-button');if(b)b.click();return 1;})()`);
  await sleep(1800);
  await ev(`(()=>{const items=[...document.querySelectorAll('.cdk-overlay-pane gem-menu-item, .cdk-overlay-pane [role=menuitemradio], .cdk-overlay-pane [role=menuitem]')];const el=items.find(o=>(o.textContent||'').includes(${JSON.stringify(model)}));if(el){el.click();return 1;}return 0;})()`);
  await sleep(3000);
  ws._listeners.delete(handler);
  if (l5) {
    const params = new URLSearchParams(l5);
    const fr = params.get('f.req');
    try { results[model] = JSON.parse(fr); console.log('L5adhe decoded full:', JSON.stringify(results[model])); }
    catch (e) { console.log('decode err', e.message, 'raw:', fr?.slice(0,300)); }
  } else { console.log('tidak ada L5adhe untuk', model); }
}

// diff antar payload
console.log('\n=== DIFF ===');
const a = JSON.stringify(results['3.6 Flash']);
const b = JSON.stringify(results['3.1 Pro']);
const na = a.split(','), nb = b.split(',');
console.log('flash len:', na.length, '| pro len:', nb.length);
for (let i=0;i<Math.max(na.length,nb.length);i++){
  if(na[i]!==nb[i]) console.log('idx', i, '| flash:', na[i], '| pro:', nb[i]);
}
process.exit(0);

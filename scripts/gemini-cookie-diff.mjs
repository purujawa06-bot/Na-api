#!/usr/bin/env node
const CDP_HTTP = 'http://127.0.0.1:9222';
const BASE = 'https://gemini.google.com';
function sleep(ms){return new Promise(r=>setTimeout(r,ms));}
function extractRaw(ev){ if(typeof ev==='string')return ev; if(ev&&typeof ev.data==='string')return ev.data; if(ev&&ev.data!==undefined&&ev.data!==null)return String(ev.data); return String(ev);}
const targets = await fetch(`${CDP_HTTP}/json/list`).then(r=>r.json());
let page = targets.find(t=>t.type==='page'&&t.url.includes('gemini.google.com')) || targets[0];
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
await sleep(9000);

// capture semua request selama 5 detik (untuk lihat apa yg terjadi saat switch model)
const reqs=[];
ws._listeners.add((raw)=>{try{const m=JSON.parse(raw);if(m.method==='Network.requestWillBeSent'&&m.params.request.url.includes('google.com'))reqs.push({method:m.params.request.method,url:m.params.request.url.slice(0,90),hasPost:!!m.params.request.postData});}catch{}});
const beforeCookie = await ev(`document.cookie || ''`);
console.log('COOKIE BEFORE (len',beforeCookie.length+')');
// buka menu & pilih 3.6 Flash
await ev(`(()=>{const b=document.querySelector('bard-mode-switcher button, .gds-mode-switch-button');if(b)b.click();return 1;})()`);
await sleep(1500);
await ev(`(()=>{const items=[...document.querySelectorAll('.cdk-overlay-pane gem-menu-item, .cdk-overlay-pane [role=menuitemradio]')];const el=items.find(o=>(o.textContent||'').includes('3.6 Flash'));if(el)el.click();return 1;})()`);
await sleep(3000);
const afterCookie = await ev(`document.cookie || ''`);
console.log('COOKIE AFTER (len',afterCookie.length+')');
// diff cookie name=value
const parseCookie=(s)=>{const o={};for(const p of s.split(';')){const i=p.indexOf('=');if(i>0){const k=p.slice(0,i).trim();const v=p.slice(i+1).trim();o[k]=v;}}return o;};
const b=parseCookie(beforeCookie), a=parseCookie(afterCookie);
console.log('--- cookie yang berubah ---');
for(const k of new Set([...Object.keys(b),...Object.keys(a)])){
  if(b[k]!==a[k]) console.log(k, '\n  before:', (b[k]||'').slice(0,40), '\n  after :', (a[k]||'').slice(0,40));
}
console.log('\n--- request saat switch (3s) ---');
console.log(JSON.stringify(reqs.slice(-8), null, 1));
process.exit(0);

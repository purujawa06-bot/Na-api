#!/usr/bin/env node
/** Investigasi: ekstrak SNlM0e + ID percakapan dari HTML gemini.google.com/app */
const CDP_HTTP = 'http://127.0.0.1:9222';
const BASE = 'https://gemini.google.com';
function sleep(ms){return new Promise(r=>setTimeout(r,ms));}
function extractRaw(ev){ if(typeof ev==='string')return ev; if(ev&&typeof ev.data==='string')return ev.data; if(ev&&ev.data!==undefined&&ev.data!==null)return String(ev.data); return String(ev);}
const page = await fetch(`${CDP_HTTP}/json/new?url=${encodeURIComponent(BASE+'/app')}`,{method:'PUT'}).then(r=>r.json());
const ws = new WebSocket(page.webSocketDebuggerUrl);
ws._listeners = new Set();
ws.onmessage = (ev)=>{ const raw=extractRaw(ev); for(const fn of ws._listeners) fn(raw); };
await new Promise(res=>{ ws.addEventListener('open',res); });
async function cmd(method,params={}){const id=Math.floor(Math.random()*1e6)+1;return new Promise((res,rej)=>{const fn=(raw)=>{const m=JSON.parse(raw);if(m.id===id){ws._listeners.delete(fn);m.error?rej(new Error(m.error.message)):res(m.result);}};ws._listeners.add(fn);ws.send(JSON.stringify({id,method,params}));});}
const ev=(expr)=>cmd('Runtime.evaluate',{expression:expr,returnByValue:true,awaitPromise:true}).then(r=>r.result?.value);
await cmd('Emulation.setDeviceMetricsOverride',{width:412,height:915,deviceScaleFactor:2,mobile:true});
await cmd('Page.navigate',{url:BASE+'/app'});
await sleep(9000);

// Ambil HTML lengkap via fetch di page context (bawa cookie login)
const html = await ev(`fetch('/app',{credentials:'include'}).then(r=>r.text()).catch(e=>'ERR:'+e)`);
console.log('HTML length:', html?.length);
// cari SNlM0e
const snl = html?.match(/SNlM0e["']?\s*:\s*["']([^"']+)["']/);
console.log('SNlM0e:', snl?snl[1].slice(0,30)+'...':'TIDAK KETEMU');
const snl2 = html?.match(/"snlm0e","([^"]+)"/) || html?.match(/window\.snlem\s*=\s*["']([^"']+)["']/);
console.log('snl alt:', snl2?snl2[1].slice(0,30)+'...':'-');
// cari pola conversation id / response id
const cid = html?.match(/[0-9a-f]{32}/g);
console.log('hex32 ditemukan:', cid?cid.length:'0', cid?cid.slice(0,3):'');
const bang = html?.match(/![\w\-_]{50,}/g);
console.log('token !... ditemukan:', bang?bang.length:'0', bang?bang.slice(0,1).map(s=>s.slice(0,30)+'...'):'');
// cari "rcid" atau "conversation"
const rc = html?.match(/rcid["']?\s*:\s*["']([^"']+)["']/);
console.log('rcid:', rc?rc[1].slice(0,30):'-');
const cid2 = html?.match(/["']conversation_id["']\s*:\s*["']([^"']+)["']/);
console.log('conversation_id json:', cid2?cid2[1].slice(0,30):'-');
process.exit(0);

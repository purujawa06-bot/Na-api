#!/usr/bin/env node
/** Test Gemini StreamGenerate via pure HTTP (Node fetch, no CDP). */
import { readFileSync } from 'node:fs';

const cookies = JSON.parse(readFileSync('./scripts/.gemini-cookies.json', 'utf8'));
const cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ');

const sniffs = JSON.parse(readFileSync('./scripts/.gemini-sniff.json', 'utf8'));
const sg = sniffs.find(c => c.url.includes('StreamGenerate'));
console.log('URL:', sg.url.slice(0, 120));

// rebuild postData: keep f.req + at, tapi ganti prompt di dalam f.req agar beda
const params = new URLSearchParams(sg.postData);
let freq = JSON.parse(params.get('f.req'));
// freq = [null, "<inner string>"]  -> parse inner
let inner = JSON.parse(freq[1]);
// ubah prompt [0][0]
inner[0][0] = 'Halo, jawab singkat: 1+1?';
freq[1] = JSON.stringify(inner);
params.set('f.req', JSON.stringify(freq));

const endpoint = sg.url.split('?')[0];
const url = `${endpoint}?${sg.url.split('?')[1]}`;

// TEST varian
const noAt = process.argv.includes('--noat');
const noXgoog = process.argv.includes('--noxgoog');
const emptyIds = process.argv.includes('--emptyids');
if (noAt) params.delete('at');
if (emptyIds) { inner[3] = ''; inner[4] = ''; freq[1] = JSON.stringify(inner); params.set('f.req', JSON.stringify(freq)); }
console.log('noAt:', noAt, '| noXgoog:', noXgoog, '| emptyIds:', emptyIds);

if (noXgoog) {
  // dihapus setelah headers didefinisikan di bawah
}

const headers = {
  'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
  'Cookie': cookieHeader,
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36',
  'Origin': 'https://gemini.google.com',
  'Referer': 'https://gemini.google.com/',
  'x-goog-ext-73010989-jspb': '[0]',
  'x-goog-ext-525001261-jspb': '[1,null,null,null,"fbb127bbb056c959",null,null,0,[4,5,6,8,4,5,6,8],null,null,1,null,null,1,1,"3DB078"]',
  'x-goog-ext-525005358-jspb': '["4B235E08-4D33-462B-92FA-08C41A4C6AC8",1]',
  'x-goog-ext-73010990-jspb': '[0,0,0]',
};

if (noXgoog) {
  delete headers['x-goog-ext-73010989-jspb'];
  delete headers['x-goog-ext-525001261-jspb'];
  delete headers['x-goog-ext-525005358-jspb'];
  delete headers['x-goog-ext-73010990-jspb'];
}

console.log('[i] mengirim...');
try {
  const res = await fetch(url, { method: 'POST', headers, body: params.toString() });
  console.log('STATUS:', res.status);
  const text = await res.text();
  console.log('BODY len:', text.length);
  console.log('BODY head:', text.slice(0, 400));
  // parse text chunks
  let modelName = null, answer = '';
  for (const part of text.split(/\n\d+\n/).slice(1)) {
    const first = part.trim().split('\n')[0];
    if (!first.startsWith('[')) continue;
    try {
      for (const e of JSON.parse(first)) {
        if (Array.isArray(e) && e[0] === 'wrb.fr') {
          const inner = JSON.parse(e[2]);
          if (typeof inner?.[42] === 'string') modelName = inner[42];
          const t = inner?.[4]?.[0]?.[1]?.[0];
          if (typeof t === 'string' && t.length > answer.length) answer = t;
        }
      }
    } catch {}
  }
  console.log('MODEL:', modelName);
  console.log('ANSWER:', answer.slice(0, 200));
} catch (e) {
  console.log('ERROR:', e.message);
}

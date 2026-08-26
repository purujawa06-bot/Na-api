#!/usr/bin/env node
/** Verifikasi pemetaan model via index [41] dengan template f.req lengkap (seed [3]/[4] asli). */
import { readFileSync } from 'node:fs';

const cookies = JSON.parse(readFileSync('./scripts/.gemini-cookies.json', 'utf8'));
const cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ');
const sniffs = JSON.parse(readFileSync('./scripts/.gemini-sniff.json', 'utf8'));
const sg = sniffs.find(c => c.url.includes('StreamGenerate'));

const params0 = new URLSearchParams(sg.postData);
const freq0 = JSON.parse(params0.get('f.req'));
const inner0 = JSON.parse(freq0[1]);

const endpoint = sg.url.split('?')[0];
const q = sg.url.split('?')[1];
const baseHeaders = {
  'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
  'Cookie': cookieHeader,
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36',
  'Origin': 'https://gemini.google.com',
  'Referer': 'https://gemini.google.com/',
};

function parseResp(text) {
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
  return { modelName, answer };
}

for (const m41 of [0, 1, 2, 3]) {
  const params = new URLSearchParams(sg.postData);
  const freq = JSON.parse(params.get('f.req'));
  const inner = JSON.parse(freq[1]);
  inner[0][0] = `Tes model index ${m41}: sebutkan angka 1+1`;
  inner[41] = [m41];
  freq[1] = JSON.stringify(inner);
  params.set('f.req', JSON.stringify(freq));

  try {
    const res = await fetch(`${endpoint}?${q}`, { method: 'POST', headers: baseHeaders, body: params.toString() });
    const text = await res.text();
    const { modelName, answer } = parseResp(text);
    console.log(`[41]=${m41} -> STATUS ${res.status} | MODEL: ${modelName} | "${answer.slice(0,40)}"`);
  } catch (e) {
    console.log(`[41]=${m41} -> ERROR ${e.message}`);
  }
  await new Promise(r => setTimeout(r, 1500));
}

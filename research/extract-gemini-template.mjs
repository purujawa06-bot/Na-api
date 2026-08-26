import { readFileSync, writeFileSync } from 'node:fs';
const sniffs = JSON.parse(readFileSync('./scripts/.gemini-sniff.json', 'utf8'));
const sg = sniffs.find(c => c.url.includes('StreamGenerate'));
const params = new URLSearchParams(sg.postData);
const fr = JSON.parse(params.get('f.req'));
const inner = JSON.parse(fr[1]);
const at = params.get('at') || null;
const url = sg.url;
writeFileSync('./scripts/gemini-freq-template.json', JSON.stringify({
  url, inner, at,
  // posisi penting di inner
  promptIdx: 0,
  languageIdx: 1,
  modelIdx: 41,
  responseModelIdx: 42,
  textIdx: 'inner[4][0][1][0]',
}, null));
console.log('template saved, inner length:', inner.length);
console.log('seed responseId[3]:', String(inner[3]).slice(0, 20));
console.log('seed convId[4]:', inner[4]);
console.log('modelIdx[41]:', JSON.stringify(inner[41]));

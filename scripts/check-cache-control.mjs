/**
 * Check: semua GET JSON endpoint ikutEDGE_CACHE_CONTROL (7 hari).
 *
 * Jalankan: node scripts/check-cache-control.mjs
 * Exit != 0 kalau ada yang regresi.
 */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { EDGE_CACHE_CONTROL } from '../lib/api-cache.js';

const ROOT = new URL('..', import.meta.url).pathname;
const API_DIR = join(ROOT, 'app/api');

const EXPECTED = 'public, s-maxage=604800, stale-while-revalidate=86400';
assert.equal(EDGE_CACHE_CONTROL, EXPECTED, 'EDGE_CACHE_CONTROL tidak sesuai');

// TTL lokal yang lebih pendek tidak bocor: middleware override, tapi
// inhale TTL_SHORT!=cache yangroute handler tulis sendiri akan tampil di client.
const SHORT_TTL = /\{\s*ttl:\s*(\d+)\s*,\s*stale:\s*(\d+)\s*\}/g;

// Cache 7 hari TIDAK boleh kena endpoint yang return-nya basi / sensitif / stream.
const MUST_NOT_CACHE = [
  '/api/admin/',
  '/api/chat/',
  '/api/deepseek/',
  '/api/text2image',
  '/api/tools-image/',
  '/api/uploader/',
  '/api/temp/',
  '/api/media/',
  '/api/chess/',
  '/api/_diag/',
];

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

const files = walk(API_DIR).filter((f) => f.endsWith('.js') || f.endsWith('.jsx'));

let shortTtl = [];
for (const file of files) {
  const src = readFileSync(file, 'utf8');
  for (const m of src.matchAll(SHORT_TTL)) {
    const [full, ttl] = [m[0], Number(m[1])];
    if (ttl < 604800) shortTtl.push(`${relative(ROOT, file)}: ${full.trim()}`);
  }
}
assert.deepEqual(shortTtl, [], `TTL lokal < 7 hari (middleware override, tapi jangan andalkan):\n  ${shortTtl.join('\n  ')}`);

const middleware = readFileSync(join(ROOT, 'middleware.js'), 'utf8');
assert.ok(middleware.includes('EDGE_CACHE_CONTROL'), 'middleware tidak memakai EDGE_CACHE_CONTROL');
assert.ok(!middleware.includes('s-maxage=300'), 'header TTL lama masih tertinggal di middleware');
for (const prefix of MUST_NOT_CACHE) {
  assert.ok(middleware.includes(`'${prefix}'`), `exclusion hilang: ${prefix}`);
}

// Guard utama: stream & non-GET tidak boleh di-cache.
assert.ok(middleware.includes('request.method === \'GET\''), 'guard GET hilang');
assert.ok(middleware.includes('isStream'), 'guard SSE/NDJSON stream hilang');
assert.ok(middleware.includes('application/json'), 'guard content-type JSON hilang');

console.log(`OK — ${files.length} route file diperiksa, edge cache = ${EXPECTED}`);
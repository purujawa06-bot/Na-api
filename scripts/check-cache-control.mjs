/**
 * Check: SEMUA response (semua method, semua content-type, private/public)
 * distamp EDGE_CACHE_CONTROL 7 hari — tanpa pengecualian.
 *
 * Jalankan: node scripts/check-cache-control.mjs
 * Exit != 0 kalau ada yang regresi.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { EDGE_CACHE_CONTROL } from '../lib/api-cache.js';

const ROOT = new URL('..', import.meta.url).pathname;

const EXPECTED = 'public, s-maxage=604800, stale-while-revalidate=86400';
assert.equal(EDGE_CACHE_CONTROL, EXPECTED, 'EDGE_CACHE_CONTROL tidak sesuai');

const middleware = readFileSync(join(ROOT, 'middleware.js'), 'utf8');
assert.ok(middleware.includes('EDGE_CACHE_CONTROL'), 'middleware tidak memakai EDGE_CACHE_CONTROL');
assert.ok(!middleware.includes('s-maxage=300'), 'header TTL lama masih tertinggal di middleware');

// No-exception policy: tidak boleh ada exclusion list, gate GET-only,
// atau gate content-type/stream. Semua jalur return harus lewat stampCacheHeader.
for (const banned of ['excluded', 'isStream', '/api/admin/', '/api/chat/', '/api/deepseek/', '/api/_diag/']) {
  assert.ok(!middleware.includes(banned), `masih ada pembatas: ${banned}`);
}
assert.ok(!middleware.includes("request.method === 'GET'"), 'masih ada gate GET-only');
assert.ok(!middleware.includes('application/json'), 'masih ada gate content-type JSON');
assert.ok(middleware.includes("matcher: '/:path*'"), 'matcher harus /:path* (semua route)');

// Setiap return response harus lewat stampCacheHeader — kecuali
// NextResponse.next() (fetch-forward gagal), early return OPTIONS,
// dan definisi stampCacheHeader itu sendiri (return new Response(res.body...)).
const bareReturn = /^(\s*)return (response|new Response\()/gm;
let leaks = [];
for (const m of middleware.matchAll(bareReturn)) {
  const after = middleware.slice(m.index, m.index + 60);
  if (after.includes('res.body')) continue; // definisi stamp itu sendiri
  const line = middleware.slice(Math.max(0, m.index - 120), m.index);
  if (!line.includes('stampCacheHeader(')) leaks.push(m[0].trim());
}
assert.deepEqual(leaks, [], `jalur return tanpa stamp:\n  ${leaks.join('\n  ')}`);

console.log(`OK — no-exception policy aktif, edge cache = ${EXPECTED}`);

/**
 * Check: semua response API (semua method, semua content-type, private/public)
 * distamp EDGE_CACHE_CONTROL 7 hari — tanpa pengecualian di dalam /api/*.
 *
 * Middleware sengaja scope /api/:path* saja — pages (_next, /, /docs, ...)
 * TIDAK boleh disentuh: fetch-forward manual + stamp s-maxage pada HTML/RSC
 * merusak client router (navigasi <Link> jatuh ke reload full page).
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

// Larangan pola yang merusak navigasi pages:
// - fetch-forward manual (fetch(request)) memutus RSC/flight pipeline
// - new Response(res.body) membangun ulang body (merusak streaming/RSC)
// - matcher global /:path* menyentuh pages + _next
for (const banned of ['fetch(forwardRequest)', 'fetch(request)', 'fetch(clone', 'new Response(res.body', "matcher: '/:path*'"]) {
  assert.ok(!middleware.includes(banned), `pola perusak navigasi masih ada: ${banned}`);
}
// Pipeline normal wajib dipakai agar RSC/flight data utuh.
assert.ok(middleware.includes('NextResponse.next()'), 'harus pakai NextResponse.next() (tanpa fetch-forward manual)');
// Scope middleware khusus API.
assert.ok(middleware.includes("matcher: '/api/:path*'"), 'matcher harus /api/:path* (jangan sentuh pages)');

// Semua return JSON error API harus bawa stamp EDGE_CACHE_CONTROL.
assert.ok(middleware.includes("'cache-control': EDGE_CACHE_CONTROL"), 'return JSON error tanpa stamp cache');

console.log(`OK — middleware API-only aktif, edge cache = ${EXPECTED}`);

# AGENTS.md

This file provides guidance to agents when working with code in this repository.

# Project Debug Rules (Non-Obvious Only)

- **Error Format Mismatch**: Most route handlers return `{ success: false, message }` on error. ping (`app/api/main/ping/route.js`) returns `{ status: 'error', message }`. Don't assume consistency.
- **Doc Failures**: If docs outdated, check `scripts/generate-docs.js` exit code or missing JSDoc tags (`@title`, `@method`, `@path`) in `lib/controllers/`.
- **Silent Failures**: `cloudscraper` may silently fail on Cloudflare challenges (403 without error). Always check response status in crawler logic.
- **POST JSON Parsing**: Some route handlers (`app/api/tools/brat/route.js`) don't wrap `req.json()` in try-catch. Invalid JSON → unhandled Next.js error, not graceful 400.
- **Static Encryption Key**: `lib/crypto.js` uses hardcoded 32-byte key (`x82m#9c...`), not env var. Key rotation requires code change.
- **DB Env Var**: Connection string is `PURUBOY_PG_URL` (non-standard name). Missing var → silent pool failure.
- **Admin Auth**: Admin endpoints check `authorization` header against `PURUBOY_ADMIN_KEY` env var. Missing header → 401.

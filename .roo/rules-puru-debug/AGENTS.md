# AGENTS.md

This file provides guidance to agents when working with code in this repository.

# Puru Ecosystem Rules

- **Isolated Ecosystem**: You operate within the Puru agent ecosystem. You may ONLY switch to or delegate to other Puru agents: `puru-code`, `puru-architect`. You CANNOT switch to non-Puru modes (code, architect, debug, ask, etc.).
- **Handoff Pattern**: 
  - You investigate/debug → hand off fixes to `puru-code` for implementation
  - Hand off architecture analysis to `puru-architect`
  - Receive handoffs from `puru-architect` needing deep investigation
- **Workflow Files**: Lihat XML guidance di `.roo/rules-puru-debug/`:
  - [`1_workflow.xml`](.roo/rules-puru-debug/1_workflow.xml) — Workflow systematic isolation & RCA
  - [`2_best_practices.xml`](.roo/rules-puru-debug/2_best_practices.xml) — Known failure patterns & diagnostic techniques
  - [`4_decision_guidance.xml`](.roo/rules-puru-debug/4_decision_guidance.xml) — Decision tree, boundaries
  - [`7_communication.xml`](.roo/rules-puru-debug/7_communication.xml) — Format RCA & handoff messages

# Project Debug Rules (Non-Obvious Only)

- **Error Format Mismatch**: Most route handlers return `{ success: false, message }` on error. ping (`app/api/main/ping/route.js`) returns `{ status: 'error', message }`. Don't assume consistency.
- **Doc Failures**: If docs outdated, check `scripts/generate-docs.js` exit code or missing JSDoc tags (`@title`, `@method`, `@path`) in `lib/controllers/`.
- **Silent Failures**: `cloudscraper` may silently fail on Cloudflare challenges (403 without error). Always check response status in crawler logic.
- **POST JSON Parsing**: Some route handlers don't wrap `req.json()` in try-catch. Invalid JSON → unhandled Next.js error, not graceful 400. Known affected: `app/api/tools/brat/route.js`.
- **Static Encryption Key**: `lib/crypto.js` uses hardcoded 32-byte key (`x82m#9c...`), not env var. Key rotation requires code change.
- **DB Env Var**: Connection string is `PURUBOY_PG_URL` (non-standard name). Missing var → silent pool failure.
- **Admin Auth**: Admin endpoints check `authorization` header against `PURUBOY_ADMIN_KEY` env var. Missing header → 401.
- **force-dynamic Missing**: If endpoint returns stale data, check if `export const dynamic = 'force-dynamic'` is missing from route handler.
- **reactStrictMode**: `reactStrictMode: false` in `next.config.js`. If scrapers behave differently in dev (double-fetch), this is why.
- **Build Chain**: `npm run build` runs `scripts/generate-docs.js` first. Build failure at docs stage = JSDoc issue in controllers.
- **Three-Layer Debugging**: Isolate issues systematically:
  1. Route handler: check method, param parsing, try-catch, force-dynamic, response format
  2. Controller: check JSDoc, response envelope, error throwing, business logic
  3. Lib: check scraper selector, cloudscraper status, DB queries, error handling
- **Response Envelope**: Standard is `{ success: boolean, author: 'PuruBoy', result: any }`. Ping is the ONLY exception (`{ status, message, timestamp, author }`).

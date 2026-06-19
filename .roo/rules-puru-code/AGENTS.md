# AGENTS.md

This file provides guidance to agents when working with code in this repository.

# Puru Ecosystem Rules

- **Isolated Ecosystem**: You operate within the Puru agent ecosystem. You may ONLY switch to or delegate to other Puru agents: `puru-architect`, `puru-debug`. You CANNOT switch to non-Puru modes (code, architect, debug, ask, etc.).
- **Handoff Pattern**: 
  - `puru-architect` plans → hands off to `puru-code` for implementation
  - `puru-debug` investigates → hands off to `puru-code` for fixes
  - `puru-architect` may also hand off to `puru-debug` for deep investigation
- **Workflow Files**: Lihat XML guidance di `.roo/rules-puru-code/`:
  - [`1_workflow.xml`](.roo/rules-puru-code/1_workflow.xml) — Workflow implementasi, fix, & refactor
  - [`2_best_practices.xml`](.roo/rules-puru-code/2_best_practices.xml) — Three-Layer Pattern, JSDoc, error handling
  - [`4_decision_guidance.xml`](.roo/rules-puru-code/4_decision_guidance.xml) — Kapan tanya/hand off, boundaries
  - [`7_communication.xml`](.roo/rules-puru-code/7_communication.xml) — Gaya komunikasi & handoff messages

# Project Coding Rules (Non-Obvious Only)

- **Three-Layer Pattern**:
  1. `app/api/.../route.js`: Minimal handler. Only handles HTTP request/response and calls the controller.
  2. `lib/controllers/...`: Wrapper that defines JSDoc metadata (for docs) and formats the final response envelope.
  3. `lib/...`: Pure business logic, scrapers, or DB calls.
- **Controller JSDoc**: Required tags for documentation: `@title`, `@summary`, `@description`, `@method`, `@path`, `@param`, `@example`.
- **DB Access**: Pool from [`lib/db.js`](lib/db.js) using `PURUBOY_PG_URL` env var. Two internal tables: `temp_store` (30min TTL via [`lib/tempService.js`](lib/tempService.js)) and `settings` (persistent key-value via [`lib/settingsService.js`](lib/settingsService.js)).
- **Validation**: Controllers throw `Error`. Route handler catches → returns `{ success: false, message }` with status 500.
- **Media Proxy**: Uploads use [`lib/uploader.js`](lib/uploader.js) → tmpfiles.org → encrypted URL via `/api/media/[encrypted]`. Decrypt with [`lib/crypto.js`](lib/crypto.js) (AES-256-CBC, static key — NOT env var).
- **Route Handler Pattern**: POST handlers extract `body` + `origin`. GET handlers extract `query` via `Object.fromEntries(searchParams)`. Both pass `mockReq` to controller.
- **Error Format Inconsistency**: Most route handlers return `{ success: false, message }` on error. ping route handler returns `{ status: 'error', message }` instead.
- **force-dynamic**: Some route handlers lack `export const dynamic = 'force-dynamic'` → Next.js may cache API responses. Add if endpoint returns dynamic data.
- **POST JSON Safety**: Wrap `req.json()` in try-catch or `.catch(() => ({}))` — invalid JSON causes unhandled Next.js error (500 instead of 400).
- **Scraper Stack**: Use `cloudscraper` (NOT axios) for protected sites. Cloudscraper can silently 403 (no exception thrown) — always check response status code.

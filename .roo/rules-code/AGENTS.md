# AGENTS.md

This file provides guidance to agents when working with code in this repository.

# Project Coding Rules (Non-Obvious Only)

- **Three-Layer Pattern**:
  1. `app/api/.../route.js`: Minimal handler. Only handles HTTP request/response and calls the controller.
  2. `lib/controllers/...`: Wrapper that defines JSDoc metadata (for docs) and formats the final response envelope.
  3. `lib/...`: Pure business logic, scrapers, or DB calls.
- **Controller JSDoc**: Required tags for documentation: `@title`, `@summary`, `@description`, `@method`, `@path`, `@param`, `@example`.
- **DB Access**: Pool from [`lib/db.js`](lib/db.js) using `PURUBOY_PG_URL` env var. Two internal tables: `temp_store` (30min TTL) and `settings` (key-value).
- **Validation**: Controllers throw `Error`. Route handler catches → returns `{ success: false, message }` with status 500.
- **Media Proxy**: Uploads use [`lib/uploader.js`](lib/uploader.js) → tmpfiles.org → encrypted URL via `/api/media/[encrypted]`. Decrypt with [`lib/crypto.js`](lib/crypto.js) (AES-256-CBC, static key).
- **Route Handler Pattern**: POST handlers extract `body` + `origin`. GET handlers extract `query` via `Object.fromEntries(searchParams)`. Both pass `mockReq` to controller.
- **Error Format Inconsistency**: Most route handlers return `{ success: false, message }` on error. ping route handler returns `{ status: 'error', message }` instead.
- **force-dynamic**: Some route handlers lack `export const dynamic = 'force-dynamic'` → Next.js may cache API responses. Add if endpoint returns dynamic data.

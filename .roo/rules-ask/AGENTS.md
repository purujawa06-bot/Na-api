# AGENTS.md

This file provides guidance to agents when working with code in this repository.

# Project Documentation Rules (Non-Obvious Only)

- **Source of Truth**: No `docs/` folder. API spec lives as JSDoc in `lib/controllers/`. Output → `public/docs.json` via `scripts/generate-docs.js`.
- **Controller Categories**: 9 actual endpoint categories in code — `ai/`, `anime/`, `chart/`, `downloader/`, `main/`, `meme/`, `search/`, `tools/`, `play/`.
- **Non-API HTML**: `public/admin.html` and `public/fastupdate.html` are standalone tools, not API endpoints. Accessible via rewrites: `/admin` → `/admin.html`, `/fastupdate` → `/fastupdate.html`.
- **Two-tier `lib/`**: `lib/controllers/` = JSDoc metadata + orchestration. `lib/` root = pure logic (scrapers, DB, utils). Some functions in `lib/` root have NO controller wrapper (e.g., `lib/brat.js`, `lib/tiktok.js`).
- **JSDoc Param Format**: Must use `{type} [query|body.paramName] - description` with bracket notation for optional params. Docs scanner regex is strict — wrong format = param not indexed.
- **ping.js is NOT standard**: `lib/controllers/main/ping.js` returns `{ status, message, timestamp, author }`, not the standard `{ success, author, result }` envelope. Don't use as template.

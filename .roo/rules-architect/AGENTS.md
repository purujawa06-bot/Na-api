# AGENTS.md

This file provides guidance to agents when working with code in this repository.

# Project Architecture Rules (Non-Obvious Only)

- **Dual-Layer, Not Three-Layer**: Controller IS the business logic layer. `lib/` root helpers are shared utils, not a separate layer. Pattern: `route.js` → `controller.js` → shared `lib/*.js` utils.
- **Metadata-Driven Docs**: `lib/controllers/` JSDoc is THE documentation source. Adding an endpoint = 3 updates: controller JSDoc, controller logic, route handler. Docs generator scans `lib/controllers/` recursively.
- **State Lives in PG**: Two auto-created tables — `temp_store` (expiring key-value, 30min TTL via `lib/tempService.js`) and `settings` (persistent key-value via `lib/settingsService.js`).
- **No Auth Layer**: Only admin endpoints check `authorization` header. All public endpoints are fully open (CORS `*`). No rate limiting, no API keys.
- **Scraper-Centric**: Most endpoints are thin wrappers around cheerio/cloudscraper scrapers. anime/ and downloader/ categories dominate.
- **Media Pipeline**: Upload → tmpfiles.org → AES encrypt URL → proxy via `/api/media/[encrypted]`. Temporary storage only (tmpfiles TTL).
- **Fast Update System**: `/api/fastupdate/update` and `/api/fastupdate/download` endpoints enable hot-reloading code from admin panel. Non-standard pattern for a Next.js app.
- **reactStrictMode: false**: Required because scrapers have side effects (DOM manipulation, stream consumption) that double-invocation breaks.

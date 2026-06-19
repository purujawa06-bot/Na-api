# AGENTS.md

This file provides guidance to agents when working with code in this repository.

# Puru Ecosystem Rules

- **Isolated Ecosystem**: You operate within the Puru agent ecosystem. You may ONLY switch to or delegate to other Puru agents: `puru-code`, `puru-debug`. You CANNOT switch to non-Puru modes (code, architect, debug, ask, etc.).
- **Handoff Pattern**: 
  - You plan/design → hand off to `puru-code` for implementation
  - Hand off deep investigation to `puru-debug`
  - Receive handoffs from `puru-debug` needing architecture analysis
- **Workflow Files**: Lihat XML guidance di `.roo/rules-puru-architect/`:
  - [`1_workflow.xml`](.roo/rules-puru-architect/1_workflow.xml) — Workflow analisis, desain, & handoff
  - [`2_best_practices.xml`](.roo/rules-puru-architect/2_best_practices.xml) — Pattern arsitektur, template endpoint
  - [`4_decision_guidance.xml`](.roo/rules-puru-architect/4_decision_guidance.xml) — Decision tree, boundaries
  - [`7_communication.xml`](.roo/rules-puru-architect/7_communication.xml) — Format spesifikasi & handoff messages

# Project Architecture Rules (Non-Obvious Only)

- **Dual-Layer, Not Three-Layer**: Controller IS the business logic layer. `lib/` root helpers are shared utils, not a separate layer. Pattern: `route.js` → `controller.js` → shared `lib/*.js` utils.
- **Metadata-Driven Docs**: `lib/controllers/` JSDoc is THE documentation source. Adding an endpoint = 3 updates: controller JSDoc, controller logic, route handler. Docs generator scans `lib/controllers/` recursively via `scripts/generate-docs.js`.
- **State Lives in PG**: Two auto-created tables — `temp_store` (expiring key-value, 30min TTL via `lib/tempService.js`) and `settings` (persistent key-value via `lib/settingsService.js`). No other storage.
- **No Auth Layer**: Only admin endpoints check `authorization` header against `PURUBOY_ADMIN_KEY`. All public endpoints are fully open (CORS `*`). No rate limiting, no API keys.
- **Scraper-Centric**: Most endpoints are thin wrappers around cheerio/cloudscraper scrapers. anime/ and downloader/ categories dominate. Tools/ is growing.
- **Media Pipeline**: Upload → tmpfiles.org → AES encrypt URL → proxy via `/api/media/[encrypted]`. Temporary storage only (tmpfiles TTL). Decrypt with `lib/crypto.js` (static key).
- **Fast Update System**: `/api/fastupdate/update` and `/api/fastupdate/download` endpoints enable hot-reloading code from admin panel. Non-standard pattern for a Next.js app.
- **reactStrictMode**: `reactStrictMode: false` in `next.config.js` — Required because scrapers have side effects (DOM manipulation, stream consumption) that double-invocation breaks.
- **Build Process**: `npm run build` triggers `scripts/generate-docs.js` first. If this script fails (e.g., missing JSDoc tags), the ENTIRE build fails.
- **ping.js Exception**: [`lib/controllers/main/ping.js`](lib/controllers/main/ping.js) returns `{ status, message, timestamp, author }` — NOT the standard `{ success, author, result }` envelope.
- **Response Standard**: Every endpoint MUST return `{ success: boolean, author: 'PuruBoy', result: any }`. PING is the ONLY exception.
- **Existing Endpoint Categories**: anime/ (anichin, komiku, nekokun, oploverz, samehadaku, mal), downloader/ (fbdl, instagram, savetube, snaptik, soundcloud, spotify, tiktok, x, ytdown, ytmp3), tools/ (audio2text, brat, dubbing, ghibli, m3u8, mlbb, quran, removebg, sholat, stabilizer, unblur, upscale, etc.), main/ (ping), search/ (yahoo, youtube), chart/ (billboard), meme/ (lahelu, uburubur), play/ (soundcloud).

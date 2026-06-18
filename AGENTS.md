# AGENTS.md

This file provides guidance to agents when working with code in this repository.

# Project Gotchas & Patterns

- **Dev Port**: Server runs on port `8080` (`npm run dev`).
- **Docs Source**: API documentation is auto-generated from JSDoc in `lib/controllers/`. Changes to endpoint metadata MUST be made there.
- **Build Process**: `npm run build` triggers `scripts/generate-docs.js` first; if this script fails, the build fails.
- **Response Standard**: Every endpoint MUST return `{ success: boolean, author: 'PuruBoy', result: any }`.
- **Cloudflare**: Use `cloudscraper` (not `axios`) for scrapers targeting protected sites.
- **reactStrictMode**: `reactStrictMode: false` in `next.config.js` — Next 14 defaults to true, intentionally disabled.
- **CORS**: Wildcard `*` allowed on all `/api/*` routes.
- **No Tests**: No test framework, runners, or directories exist in this project.
- **ping.js Exception**: `lib/controllers/main/ping.js` returns `{ status, message, timestamp, author }` — NOT the standard `{ success, author, result }` envelope.
- **Query Wrapping**: Route handlers wrap query params into `mockReq = { query }` before calling the controller function.

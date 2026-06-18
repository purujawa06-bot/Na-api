# AGENTS.md

This file provides guidance to agents when working with code in this repository.

# Project Architecture Rules (Non-Obvious Only)

- **Decoupling**: The Controller layer exists specifically to decouple Next.js Route Handlers from the core logic and the documentation generator.
- **Metadata-Driven**: The system is designed so that adding an endpoint requires updating three distinct locations to ensure the documentation stays in sync with the implementation.
- **Statelessness**: API handlers are intended to be stateless, relying on PostgreSQL via `lib/db.js` for persistence.
- **reactStrictMode: false**: Intentionally disabled in `next.config.js` to avoid double-render in dev — critical for scraper logic with side effects.
- **Scraper-Heavy**: Architecture dominated by endpoints wrapping external sites (anime, downloader).
- **lib/ Role**: `lib/` contains pure functions/utilities; `lib/controllers/` holds metadata + orchestration logic.

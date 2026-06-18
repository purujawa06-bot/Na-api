# AGENTS.md

This file provides guidance to agents when working with code in this repository.

# Project Debug Rules (Non-Obvious Only)

- **Isolation**: Debug logic in `lib/` independently of the Next.js route handlers to isolate framework-level issues from logic errors.
- **Doc Failures**: If the documentation UI is outdated, check if `scripts/generate-docs.js` is failing or if JSDoc tags in `lib/controllers/` are missing.
- **Silent Failures**: Check `cloudscraper` logs; Cloudflare challenges may cause silent failures or 403s that aren't captured by standard `axios` error handlers.
- **ping.js Format**: `lib/controllers/main/ping.js` uses a DIFFERENT response format — do NOT use it as reference for the standard envelope.
- **Docs Output**: Check `public/docs.json` for the latest generated documentation output when debugging doc issues.

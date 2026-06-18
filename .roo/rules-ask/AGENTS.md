# AGENTS.md

This file provides guidance to agents when working with code in this repository.

# Project Documentation Rules (Non-Obvious Only)

- **Source of Truth**: The codebase is the documentation. Do not look for a `docs/` folder for API specs; refer to `lib/controllers/`.
- **Output**: The generated documentation is stored in `public/docs.json` after a build.
- **Organization**: `lib/` contains the "how", `lib/controllers/` contains the "what" (API spec).
- **No docs/ folder**: Documentation exists only as JSDoc in controllers + generated JSON. No dedicated `docs/` directory.
- **Non-API HTML**: `admin.html` and `fastupdate.html` in `public/` are non-API features, not endpoints.
- **Controller Categories**: 8 categories — `ai/`, `anime/`, `downloader/`, `main/`, `meme/`, `search/`, `tools/`, `play/`.

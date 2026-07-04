# NextA-API (Tiyanz API)

Project API Publik yang modular, modern, dan kaya fitur, dibangun menggunakan **Next.js 14** (App Router). Project ini menyediakan berbagai layanan REST API mulai dari AI Tools, Downloader, hingga Anime Streaming.

## 🚀 Project Overview

- **Framework**: Next.js 14 (App Router)
- **Styling**: Tailwind CSS
- **Database**: PostgreSQL (via `pg`)
- **Documentation**: Auto-generated from JSDoc in controllers.
- **Key Features**: AI (Gemini, Flux, etc.), Downloaders (YT, TikTok, IG), Anime (Oploverz, MAL), and Image Tools.

## 📂 Architecture & Directory Structure

- **`app/api/`**: Contains the Next.js Route Handlers (`route.js`). These are the actual HTTP endpoints.
- **`lib/`**: Core business logic, scrapers, and wrappers for external APIs.
- **`lib/controllers/`**: Standardized controller files used primarily for documentation generation. Each file should contain JSDoc metadata.
- **`components/`**: React components used for the frontend (documentation pages, blog, etc.).
- **`public/`**: Static assets and the generated `docs.json`.
- **`scripts/`**: Utility scripts, notably `generate-docs.js`.

## 🛠️ Building and Running

- **Development**: `npm run dev` (Runs on port 8080)
- **Build**: `npm run build` (This runs `node scripts/generate-docs.js` before `next build`)
- **Production Start**: `npm start`
- **Linting**: `npm run lint`

## 📝 Development Conventions

### API Endpoint Creation

1.  **Core Logic**: Implement the logic in a new file in `lib/` or update an existing one.
2.  **Controller**: Create a corresponding file in `lib/controllers/[category]/[name].js`.
    - Use JSDoc to document the endpoint. Required tags: `@title`, `@summary`, `@description`, `@method`, `@path`, `@param`, `@example`.
    - The `scripts/generate-docs.js` script scans these files to build the documentation UI.
3.  **Route Handler**: Create the endpoint in `app/api/[category]/[name]/route.js`.
    - Import and use the core logic from `lib/`.
    - Return responses using `NextResponse.json`.

### Response Format

Standard successful response:
```json
{
  "success": true,
  "author": "Tiyanz",
  "result": { ... }
}
```

Standard error response:
```json
{
  "success": false,
  "error": "Error message"
}
```

### Environment Variables

Ensure `.env.local` is configured with:
- `PURUBOY_PG_URL`: PostgreSQL connection string.
- `PURUBOY_ADMIN_KEY`: Key for administrative actions.
- `Contact Header`: https://t.me/tiyanz_hub (Updated from WhatsApp)

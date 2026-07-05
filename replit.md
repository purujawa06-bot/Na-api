# NextA-API (Tiyanz API)

## Overview

NextA-API is a modular public API platform built with Next.js 14, providing various services including AI tools, media downloaders, anime streaming, and utility tools. The project follows a controller-based architecture where business logic is separated from route handlers, making it easy to add new features and maintain existing ones.

The API serves as a unified backend for multiple services:
- **AI Tools**: Text-to-speech, image generation, chat interfaces (Vheer, Typli, Svara, Grok, etc.)
- **Downloaders**: TikTok, YouTube, Instagram, Facebook, SoundCloud
- **Anime**: Streaming and search via Oploverz and MyAnimeList
- **Tools**: Image processing, background removal, upscaling

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture
- **Framework**: Next.js 14 with React 18
- **Styling**: Tailwind CSS with custom CSS variables for theming
- **Components**: Located in `components/` directory
- **Pages**: App Router structure in `app/` directory
- **Static Files**: Admin interfaces in `public/` as standalone HTML files (admin.html, fastupdate.html)

### Backend Architecture
- **API Routes**: Located in `app/api/` following Next.js App Router conventions
- **Controllers**: Business logic in `lib/controllers/` organized by category (ai/, anime/, downloader/, main/)
- **Services**: Database interactions and utilities in `lib/` root (blogService.js, chatService.js, tempService.js)
- **JSDoc Documentation**: Controllers use JSDoc comments with custom tags (@title, @summary, @path, etc.) for auto-generating API documentation

### Controller Pattern
Each API endpoint follows this pattern:
1. Route handler in `app/api/[category]/[feature]/route.js` handles HTTP requests
2. Controller in `lib/controllers/[category]/[feature].js` contains business logic
3. Utility libraries in `lib/` provide reusable functionality (scrapers, API clients)

### Data Storage
- **PostgreSQL**: Primary database via `pg` library, connection pool in `lib/db.js`
- **Connection**: Requires `PURUBOY_PG_URL` environment variable
- **Tables**: blogs, chats, typli_sessions, temp_store (auto-created if missing)

### Authentication
- **Admin Routes**: Protected by `PURUBOY_ADMIN_KEY` environment variable (header-based auth)
- **Chat Security**: Uses HMAC signatures, timestamps, and device IDs to prevent tampering
- **Encryption**: Custom AES-256-CBC encryption in `lib/crypto.js` for URL proxying

### API Response Format
All API endpoints return consistent JSON structure:
```json
{
  "success": true,
  "author": "Tiyanz",
  "result": { ... }
}
```

### Build Process
- Pre-build script `scripts/generate-docs.js` scans controllers and generates `public/docs.json`
- Documentation is auto-generated from JSDoc comments in controller files

## External Dependencies

### Third-Party APIs & Services
- **AI Services**: Vheer, Typli.ai, ToolBaz (Grok), Svara, ChatEspanyol, ScreenApp (Gemini proxy), Aitwo TTS
- **Downloaders**: TikWM (TikTok), AllInOneDownloader (Instagram), Forhub (SoundCloud), fsave.io (Facebook), YTDown (YouTube)
- **Anime Sources**: Oploverz (scraping), Jikan API (MyAnimeList)
- **Image Processing**: Pixelcut, Kolorize, Cloudinary (upscaling), Ghibli proxy

### Media Handling
- **File Upload**: Custom uploader to `puruh2o-backend.hf.space`
- **Proxy System**: Encrypted URLs via `/api/media/` endpoint to protect original sources
- **Remote Browser**: `puruh2o-gabutcok.hf.space` for Puppeteer-based automation (Vheer, YTDown, Brat generator)

### Database
- **PostgreSQL**: Required for session management, blog posts, chat history, and temporary storage
- **Environment Variable**: `PURUBOY_PG_URL` - PostgreSQL connection string

### Key NPM Packages
- `axios`: HTTP client for external API calls
- `cheerio`: HTML parsing for web scraping
- `pg`: PostgreSQL client
- `crypto-js`: Encryption utilities
- `form-data`: Multipart form handling for file uploads
- `uuid`: Unique ID generation for database records
# AGENTS.md

## Aturan kerja
- Komunikasi: bahasa Indonesia.
- Sebelum menulis/mengedit/mereview kode, muat skill `agent-memory-gardener`; jaga `AGENTS.md` ringkas dan catat lokasi kode penting di `book.txt`.
- Detail arsitektur/scraper ada di `CODEBASE.md` — perbarui di sana saat berubah, jangan duplikasi ke sini.
- File dummy/eksperimen hanya di `temp/` (gitignored). Jangan commit secret atau file >5MB.
- Kecuali diminta: jangan jalankan `npm run dev/build/start`, `git commit`, `git push`.
- **Encoding file (penting, jangan diulangi)**: **jangan pernah menulis/edit file dari PowerShell** (termasuk `Set-Content`, `Out-File`, here-string, pipeline `>`, redirect, atau `git show ... > file`) untuk file berisi Unicode (emoji, box drawing `╭│├╰`, huruf small-caps, dsb.) — di Windows PowerShell 5.1 ini merusak encoding (BOM/UTF-16/byte multibyte) dan menyebabkan mojibake (`â•­`, `ã€•`, `\n` literal, `ðŸ“¸`, `�?`). Selalu simpan sebagai **UTF-8 tanpa BOM** menggunakan Node `fs.writeFileSync(path, content, "utf8")` atau tool `write`/`edit`, atau script ASCII-safe (escape `\uXXXX`) yang ditulis via tool/Node lalu dijalankan dengan `node`.

## Perintah & verifikasi
- Lint: `npm run lint` (ESLint `next/core-web-vitals`).
- Docs endpoint: edit JSDoc di `legacy/next-api` (bukan runtime) lalu `node scripts/rebuild-docs.js` → regenerate `public/docs.json` (gagal jika JSDoc kurang). Build full: `npm run build:full` (`rebuild-docs` + `next build`).
- Backend Go (1.26): `cd backend && go build ./... && go vet ./... && go test ./...`; dev `npm run backend:dev` (8081), Docker `npm run backend:docker` (8080).
- CI (`.github/workflows/ci.yml`, Node 22, `npm ci`): lint → `rebuild-docs` → `next build` + `go build/vet/test` (env dummy `PURUBOY_PG_URL`, `PURUBOY_ADMIN_KEY`; cek file >5MB selain lockfile).
- Uji manual: `node temp/test-<nama>.mjs` atau `node scripts/test-<nama>.mjs [args]` (banyak uji tembak upstream live; kuota GitHub anonim 60/jam, opsional `GITHUB_TOKEN`, jangan loop).

## Arsitektur & batasan
- Next.js 14 App Router static export (GitHub Pages) + backend Go/Fiber (`backend/internal/*`). Frontend memanggil backend **langsung** (tanpa proxy `/api/*` di Next).
- Base URL frontend (`lib/apiBase.js`): `NEXT_PUBLIC_BACKEND_URL` → `config.json.backendUrl` → `http://localhost:8081`. Backend Koyeb (deploy saat ini): `https://na-api-nue-api-e7bfd3f4.koyeb.app`.
- `legacy/next-api/**` = sumber JSDoc/docs saja (bukan runtime). `lib/` = referensi scraper JS lama untuk `scripts/` (bukan runtime backend). UI: `components/`, `app/{docs,blog,chat,purtv,...}`.
- Registry model tunggal: `backend/internal/aimodels/registry.go` (padanan `lib/ai-models.js`) → sumber `/api/models`, settings, admin.
- Endpoint chat publik: `POST /api/chat/completions` (`/v1/...` tak tersedia).
- Middleware Go: rate limit 100 req/menit/IP, CORS, cache 7 hari; `no-store` untuk prefix dynamic (`chat/temp/tools/admin/agent-tools/models/user-scripts/dll`). Cache GET JSON via `internal/cache` + `cache-control`; jangan cache POST/upload/SSE/NDJSON/endpoint personal.
- Next export: `output: 'export'`, `images.unoptimized`, `ws` di `serverComponentsExternalPackages`; admin via `/admin.html`.
- Remote CDP/browser (bukan khusus TikTok):
  - `wss://light-panda-cdp.onrender.com/` — fallback TikTok downloader (Go, ssstik), `backend/internal/downloader/tiktok.go` (`lightpandaCDP`).
  - default `wss://browser-yq20.onrender.com/` (env `CDP_WS_URL`/`BING_CDP_URL`) — Bing/search JS, `lib/cdp-browser.js` + `lib/bing-cdp.js` (stack lama, lihat `lib/ai-search.js`).

## Konvensi endpoint & docs
- Endpoint Go baru: tambah padanan JSDoc di `legacy/next-api` (`@title @summary @method @path @example`; `@param` body sinkron `@example`) lalu rebuild docs.
- `/docs` kategori = folder pertama `legacy/next-api` (override: `CATEGORY_OVERRIDES` di `lib/docsService.js`). `INTERNAL_CATEGORIES` (`_diag,admin,blogs,chat,pages,temp,user-scripts`) tidak masuk `public/docs.json`.
- `/api/tools-image/*`: streaming NDJSON (`processing` tiap 2s, `uploading`, `done`), bukan JSON biasa.
- Hasil tmpfiles: `data.url` = halaman viewer; file langsung dari `src` `img#img_preview`.
- Scraper: hindari `got-scraping` untuk scraper baru (merusak build Next). Kena Cloudflare: proxy `vercel-api-beta-red.vercel.app`.
- Menu bot puruLocal: 1 command utama per entri (tanpa alias/deskripsi).

## Deploy
- Backend: push `main` yang mengubah `backend/**`, `lib/easemate-web.js`, `lib/easemate-wasm.js`, `.github/scripts/deploy-koyeb.mjs`, `.github/workflows/deploy-backend.yml` (atau `workflow_dispatch`) → deploy ke Koyeb (app `na-api`, service `backend`, region `fra`, instance `free`). Butuh secret `KOYEB_API_TOKEN`; setelah deploy samakan `backendUrl`/`NEXT_PUBLIC_BACKEND_URL` dengan URL dari job summary.
- Frontend Pages: `.github/workflows/deploy-pages.yml` build dengan `NEXT_PUBLIC_BASE_PATH=''` (local default bisa `/Na-api`).
- Env lokal: `.env.example` → `.env.local`. Tanpa `PURUBOY_PG_URL`, `lib/db.js` pakai pool dummy (throw saat query, import aman).
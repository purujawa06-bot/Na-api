# CODEBASE.md

Dokumen ini menyimpan informasi arsitektur, struktur, dan konteks proyek. Perbarui saat ada perubahan penting; buang info yang usang.

## Ringkasan

**Na-api** — platform API Next.js 14 (App Router) dengan endpoint bergaya OpenAI (chat/completions) dan layanan multimedia (downloader, dramabox, text2image, tools-image). Deploy ke Vercel Production.

- Package: `na-api`, Next.js `14.2.3`, React 18, Node runtime.
- Script build: `node scripts/rebuild-docs.js && next build`.
- Menggunakan beberapa layanan pihak ketiga via reverse engineering (Gemini, DeepSeek, iloveimg, vheer, dll), tanpa hardcode token.

## Struktur Direktori

- `app/api/**` — endpoint API (App Router).
  - `app/api/chat/completions` — endpoint OpenAI-compatible chat.
  - `app/api/deepseek/` — instant, reasoning, vision via deepseek.
  - `app/api/downloader/` — instagram, soundcloud, tiktok, youtube.
  - `app/api/dramabox/` — home, category, detail, search, stream.
  - `app/api/tools-image/upscaler` — perbesar gambar AI (iloveimg) + upload ke tmpfiles.
  - `app/api/temp/[id]` — temp file service.
  - `app/api/admin/` — login, aichain, featured.
- `lib/` — logika bisnis/scraper client.
- `scripts/` — test serta file sniff (hasil reverse engineering, berformat `.json`).
- `utils/` — helper kecil (`urlCleaner.js`).
- `app/docs`, `app/blog`, `app/chat`, dll — halaman UI/frontend.
- `public/docs.json` — dokumentasi API yang dibangkitkan `scripts/rebuild-docs.js`.

## Endpoint Utama & Konvensi

- Endpoint tools biasa mengembalikan `NextResponse.json(...)`, tetapi `upscaler` memakai **streaming NDJSON** (`application/x-ndjson`) dengan event `processing`, `uploading`, `done`.
- `route.js` endpoint meng-import client dari `lib/`. Contoh: `upscaler` → `lib/iloveimg-upscaler.js`.
- Konvensi wrapper `downloadImage`/`getSession` memakai User-Agent Chrome untuk menghindari blokir.

## Kategori Dokumentasi (docs.json) — 09/2026

Kategori di `public/docs.json` diatur via `CATEGORY_OVERRIDES` di `lib/docsService.js` (key = rel path dari `app/api`, value = kategori). Default = folder pertama. Saat ini kategori: `AI`, `downloader`, `nonton/baca`, `search`, `tools-image`.

- **AI**: chat/completions, chess/maia, deepseek/*, models, text2image.
- **nonton/baca** (berisi `/` — aman sebagai key label): seluruh dramabox (home, category, detail, search, stream) + seluruh komiku (home, pustaka, detail, chapter, genre, search).
- Ikon kategori di `components/DocsClient.jsx` (`CATEGORY_ICONS`); `nonton` → `fa-tv`, `ai` → `fa-robot`.

## Scraper Komiku (09/2026)

`app/api/komiku/*` + `lib/komiku.js` (parsing HTML pakai **cheerio**, sudah dependency).

- Sumber: komiku.org (SSR) untuk home/detail/chapter; api.komiku.org (API internal htmx) untuk listing pustaka/genre/pencarian.
- Endpoints: `/api/komiku/home`, `/pustaka?tipe=&orderby=&genre=&genre2=&status=&page=`, `/detail?slug=`, `/chapter?url=<permalink>`, `/genre?genre=&page=`, `/search?q=&page=`.
- Catatan penting: objek `mangaData`/`chapterData` memakai **key polos + string single-quote** (bukan JSON valid). `parseFlatJsObject()` mengurai literal objek JS datar via regex. Gambar chapter diambil dari `#Baca_Komik img` (filter iklan `komiku-promosi.webp`). Daftar genre diambil dari `<select name="genre">` di halaman `/pustaka/`.

## Catatan Penting: Image Upscaler + tmpfiles (09/2026)

`app/api/tools-image/upscaler/route.js` + `lib/iloveimg-upscaler.js`:

- Alur: ambil session (token+taskId+server) dari halaman iloveimg → unduh gambar → `POST /v1/upload` → `POST /v1/upscale` → dapat buffer PNG.
- Hasil diupload ke `https://tmpfiles.org/api/v1/upload`.
- **Bug yang diperbaiki:** `data.url` dari API tmpfiles adalah **halaman viewer HTML**, bukan file gambar langsung. Juga, `https://tmpfiles.org/dl/<id>/<file>` (tanpa segmen numerik) hanya 302-redirect kembali ke halaman viewer.
- **Solusi:** fetch halaman `data.url`, lalu ekstrak `src` dari elemen `img#img_preview` (regex `src="(https://tmpfiles\.org/dl/[^"]+)"`). URL itu (bentuk `https://tmpfiles.org/dl/<numeric>.<hash>/<id>/<file>`) mengembalikan `Content-Type: image/png` asli.
- Kontrak respons `done`: `{ event, success, url (link langsung), scale, source: 'iloveimg' }`.

## Konvensi Diet (AGENTS.md)

- Komunikasi wajib bahasa Indonesia.
- Baca `CODEBASE.md` sebelum mulai; jaga tetap aktual, prune info usang.
- Fokus pada tugas; tanpa perombakan di luar cakupan.
- Verifikasi hasil dengan deploy ke Vercel Production.
- Dilarang `git commit`/`git push` dan `npm run start`/`dev`/`lint` kecuali diminta eksplisit.

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
  - `app/api/purtv/` — home, detail, series, schedule, search, genres, list (sumber anichin.cafe, data frontend purtv.vercel.app).
  - `app/api/tools-image/upscaler` — perbesar gambar AI (iloveimg) + upload ke tmpfiles.
  - `app/api/tools-image/remove-background` — hapus latar belakang gambar (iloveimg) + upload ke tmpfiles.
  - `app/api/tools-image/html-to-image` — konversi halaman web/URL jadi gambar (iloveimg) + upload ke tmpfiles.
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

Kategori di `public/docs.json` diatur via `CATEGORY_OVERRIDES` di `lib/docsService.js` (key = rel path dari `app/api`, value = kategori). Default = folder pertama. Saat ini kategori: `AI`, `downloader`, `nonton/baca`, `search`, `tools`.

- **AI**: chat/completions, chess/maia, deepseek/*, models, text2image.
- **tools** (gabungan `tools-image` + folder tools lain): seluruh `tools-image/*` (upscaler, remove-background, html-to-image) di-map ke `tools` via `CATEGORY_OVERRIDES`. Folder default tetap `tools-image`.
- **nonton/baca** (berisi `/` — aman sebagai key label): seluruh dramabox (home, category, detail, search, stream) + seluruh komiku (home, pustaka, detail, chapter, genre, search) + seluruh purtv (home, detail, series, schedule, search, genres, list).
- Ikon kategori di `components/DocsClient.jsx` (`CATEGORY_ICONS`); `nonton` → `fa-tv`, `ai` → `fa-robot`, `tools` → `fa-wrench`.

## Scraper Komiku (09/2026)

`app/api/komiku/*` + `lib/komiku.js` (parsing HTML pakai **cheerio**, sudah dependency).

- Sumber: komiku.org (SSR) untuk home/detail/chapter; api.komiku.org (API internal htmx) untuk listing pustaka/genre/pencarian.
- Endpoints: `/api/komiku/home`, `/pustaka?tipe=&orderby=&genre=&genre2=&status=&page=`, `/detail?slug=`, `/chapter?url=<permalink>`, `/genre?genre=&page=`, `/search?q=&page=`.
- Catatan penting: objek `mangaData`/`chapterData` memakai **key polos + string single-quote** (bukan JSON valid). `parseFlatJsObject()` mengurai literal objek JS datar via regex. Gambar chapter diambil dari `#Baca_Komik img` (filter iklan `komiku-promosi.webp`). Daftar genre diambil dari `<select name="genre">` di halaman `/pustaka/`.

## Scraper PurTV (09/2026)

`app/api/purtv/*` + `lib/purtv.js` (parsing HTML pakai **cheerio**).

- Sumber: anichin.cafe (SSR) — ini sumber data frontend **purtv.vercel.app** (SPA React). Frontend itu men-scrape lewat proxy pihak ketiga (`vercel-api-beta-red.vercel.app/api/scraper-web`) + samehadaku; modul ini mengganti proxy tsb dengan scraping langsung.
- Endpoints: `/api/purtv/home`, `/detail?url=`, `/series?url=`, `/schedule`, `/search?q=&page=`, `/genres`, `/list?genre=&page=`. Semua di-map ke kategori `nonton/baca` via `CATEGORY_OVERRIDES` di `lib/docsService.js`.
- Selektor penting (markup live): home (`#slidertwo .swiper-slide.item`, `.bixbox:has(.releases.hothome)`, `.listupd.normal article.bs`, `.ongoingseries ul li`, `.series-gen`), episode (`#pembed iframe`, `.mirror option` — nilai **base64** iframe di-decode jadi `src`), seri (`/seri/<slug>/`: `.eplister ul li a`, `.infox .spe span` → `info` key/value, `.infox .genxed a`), filter genre (`/seri/?page=N&genre%5B0%5D=<slug>`), jadwal (`/schedule/` → `.bixbox.schedulepage`).
- Catatan: halaman detail episode hari ini **tidak** memuat `.eplister`/`.download-eps`/`#server .east_player_option` (selector lama di bundle PurTV sudah usang) — daftar episode ada di halaman `/seri` via `navigation.allEpisodes`. Download links diparse defensif (jika ada).
- **Cloudflare Managed Challenge:** anichin.cafe di balik CF `cType:'managed'` (turnstile) yang memblokir IP datacenter (Vercel) → 403 "Just a moment" untuk SEMUA path (HTML & wp-json). `cloudscraper` TIDAK bisa menyelesaikan (beda dari quillbot yang challenge-nya klasik). Solusi: `getHtml()` di lib fallback ke proxy transport yang dipakai frontend purtv.vercel.app (`https://vercel-api-beta-red.vercel.app/api/fetch?get=<url>`), lalu parse HTML yang sama dengan cheerio. Terverifikasi jalan di produksi (deploy 09/2026).
- Uji: `node temp/test-purtv.mjs`.

## Pemetaan ID Model (09/2026)

ID publik di `lib/ai-models.js` kini merujuk ke **identitas model asli** (di-probe via
prompt "kamu model AI apa" lewat `puruboy-api.vercel.app/api/chat/completions`).

| ID lama | ID baru | label | identitas |
|---|---|---|---|
| gemini-lite | gemini-3.6-flash | Gemini 3.6 Flash | Gemini 3.6 Flash |
| gemini-share | gemini | Gemini | Gemini (inkonsisten versi) |
| easemate | gemini-1.5-flash | Gemini 1.5 Flash | gemini-1.5-flash |
| puru | claude-opus-4 | Claude Opus 4 | claude-opus-4-20250514 |
| quillbot | gpt-4.1-mini | GPT-4.1 Mini | gpt-4.1-mini |
| auto | auto | Auto (Fallback) | — |

- **Breaking change**: id `gemini-lite`/`easemate`/`gemini-share`/`puru`/`quillbot`
  TIDAK lagi valid di `/api/chat/completions` (`createWebModel` throw "Model tidak dikenal").
- `ownedBy`/`provider` internal (gemini-web, gemini-share, easemate-web, puru-openai,
  quillbot-web) & nama file provider TIDAK berubah — hanya id publik.
- `settingsService`/`docsService` turun otomatis dari `ai-models.js`; chain lama di DB
  yang memakai id lama dibuang `sanitizeAutoChain` → fallback ke `AUTO_CHAIN_DEFAULT`.
- `AUTO_CHAIN_DEFAULT = ['gemini-3.6-flash', 'gemini-1.5-flash']`.

## Model Puru AI (09/2026)

`lib/puru-web.js` + `lib/ai-provider-web.js` — model id publik `claude-opus-4` (label "Claude Opus 4") untuk `/api/chat/completions`.
Upstream Koyeb dikirimi `model: "puru"` (alias endpoint); probe identitas: **claude-opus-4-20250514**.

- Upstream: Koyeb endpoint (`https://productive-alyson-nue-api-e6b8b676.koyeb.app/v1`) dengan model name `puru`.
- Konfigurasi env: `PURUBOY_PURU_BASE_URL` (default ke Koyeb) & `PURUBOY_PURU_API_KEY` (opsional).
- Streaming real (SSE) — pola sama dengan EaseMate.
- Buffering penuh untuk non-streaming (`fakeSingleChunkStream` atau loop `streamPuru`).

### Native multi-role (09/2026)

Puru satu-satunya provider yang menuju endpoint **OpenAI-compatible** (`/v1/chat/completions`),
jadi memakai **native `messages[]` multi-role** (system/user/assistant) alih-alih flat string.
- `lib/ai-provider-web.js` → `toOpenAiMessages(v4Prompt)` mengonversi `LanguageModelV4Prompt`
  (array content parts) menjadi `{system?, messages[]}` OpenAI. UI-TARS middleware sudah
  mengubah tool-call/tool-result jadi **teks XML**, jadi fungsi cukup ekstrak `text` dari parts
  & petakan role.
- `lib/puru-web.js` → `streamPuru({ system, messages })` kirim `messages[]` native ke upstream.
- **Tools pakai UI-TARS** (`uiTarsToolMiddleware`): definisi tools di-inject ke system
  prompt, tool call diparse dari teks XML — sama seperti provider lain.
- Provider lain (gemini-web, gemini-share-web, easemate-web, quillbot-web) **tetap flat string**
  via `flattenV4Prompt` karena endpoint-nya tak mendukung native multi-role (satu field teks,
  tanpa role). Hanya tambah native bila endpoint OpenAI-compatible baru muncul.

## Catatan Penting: Image Upscaler + tmpfiles (09/2026)

`app/api/tools-image/upscaler/route.js` + `lib/iloveimg-upscaler.js`:
- Alur: ambil session (token+taskId+server) dari halaman iloveimg → unduh gambar → `POST /v1/upload` → `POST /v1/upscale` → dapat buffer PNG.
- Hasil diupload ke `https://tmpfiles.org/api/v1/upload`.
- **Bug yang diperbaiki:** `data.url` dari API tmpfiles adalah **halaman viewer HTML**, bukan file gambar langsung. Juga, `https://tmpfiles.org/dl/<id>/<file>` (tanpa segmen numerik) hanya 302-redirect kembali ke halaman viewer.
- **Solusi:** fetch halaman `data.url`, lalu ekstrak `src` dari elemen `img#img_preview` (regex `src="(https://tmpfiles\.org/dl/[^"]+)"`). URL itu (bentuk `https://tmpfiles.org/dl/<numeric>.<hash>/<id>/<file>`) mengembalikan `Content-Type: image/png` asli.
- Kontrak respons `done`: `{ event, success, url (link langsung), scale, source: 'iloveimg' }`.

## Catatan Penting: Tools-image (upscaler & remove-background) — WAJIB STREAMING NDJSON

Semua endpoint `app/api/tools-image/*` memakai **streaming NDJSON** (`application/x-ndjson`)
dengan event `processing` (heartbeat tiap 2s), `uploading`, lalu `done`. JANGAN pakai
`NextResponse.json()` polos untuk hasil tools-image — konsisten dengan upscaler.

`app/api/tools-image/remove-background/route.js` + `lib/iloveimg-removebg.js`:

- Alur sama dengan upscaler: `getSession()` (token+taskId+server dari HTML) → unduh gambar → `POST /v1/upload` → `POST /v1/removebackground` → langsung dapat buffer PNG transparan (tanpa polling).
- Nama file hasil `_nobg.png`. Upload ke `https://tmpfiles.org/api/v1/upload` lalu ekstrak URL langsung dari `src` `img#img_preview` (pola `https://tmpfiles.org/dl/<...>`).
- Jika URL sumber tanpa ekstensi gambar (mis. `picsum.photos/600/400`), lib menyisipkan ekstensi sesuai `content-type` agar upload iloveimg tidak ditolak (`InvalidExtension`).
- Contract `done`: `{ event:'done', success, source:'iloveimg', url (link langsung), filename, mimetype }`.
- Contoh gambar untuk docs/uji pakai `https://puruboy-api.vercel.app/example.jpg` (sama seperti upscaler & deepseek/vision).

## Catatan Penting: HTML-to-Image (iloveimg) — 09/2026

`app/api/tools-image/html-to-image/route.js` + `lib/iloveimg-html.js` + `research/.iloveimg-htmltoimage-sniff.json`:

- Alur: `getSession()` (token+taskId+`server` dari HTML halaman `html-to-image`) → `POST /v1/upload` (`task` + `cloud_file` = URL web) dapat `server_filename` (`.url`) → `POST /v1/process` (`tool:htmlimage`, `url`, `view_width`, `to_format`, `files[0][server_filename]`, `files[0][filename]=hostname`) → `GET <server>/v1/download/<taskId>` dapat file gambar hasil (retry + delay 1.5s).
- **Bedanya dari upscaler/removebg:** input berupa URL halaman web (bukan upload file gambar), dan `server` pada halaman html-to-image bernilai domain penuh (`api32.ilovepdf.com`), bukan `api1g`. Lib menormalisasi: jika server mengandung `.` → `https://<server>`, selain itu `https://<server>.iloveimg.com`.
- **Penting:** `to_format` HANYA `jpg` atau `svg` (dari `<select name="to_format">`); kirim `png` → error 400 `To Format is invalid`. Default `jpg`.
- Step `/v1/preview` TIDAK diperlukan untuk `process`; memanggilnya justru bisa bikin task error. Skip saja.
- Param: `file` (URL web, wajib), `view_width` (default 1920), `to_format` (jpg/svg, default jpg).
- Contract `done` NDJSON: `{ event:'done', success, source:'iloveimg', url (link langsung tmpfiles), filename, mimetype }`.
- Contoh uji lib: `node scripts/test-htmltoimage.mjs` (assert-based, pakai `https://example.com`).

## Cookie Jar Gemini via Firebase RTDB (09/2026)

`lib/firebase-cookie-jar.js` — cookie guest/anonymous Gemini disimpan & di-refresh
di Firebase RTDB public (`https://puru-69425-default-rtdb.firebaseio.com/`, rules
`.read/.write=true`, hardcode, tanpa auth/env). Serialisasi pakai `tough-cookie`
(lewat `toJSON()`/`Cookie.fromJSON`), key path RTDB = nama model.

- `getCookieHeader(model)` → string `Cookie` utk request berikutnya dari jar.
- `saveCookies(model, res)` → baca `res.headers.getSetCookie()`, refresh jar, lalu PUT balik.
- Gemini web (`lib/gemini-web.js`) & share (`lib/gemini-share-web.js`) kini membaca
  cookie dr RTDB sebelum request, kirim sbg header `Cookie`, lalu simpan Set-Cookie
  respons kembali (refresh). ID jar: `gemini-3.6-flash` & `gemini` (pisah per model).
- `saveCookies` error PUT dibungkus `.catch` (non-fatal; request tetap jalan).
- Uji: `node scripts/test-firebase-cookie.mjs` (simulasi jar) + node gemini jalan di local.

## Model QuillBot AI (09/2026)

`lib/quillbot-web.js` + `research/quillbot.sniff.json` — model id publik `gpt-4.1-mini` (label "GPT-4.1 Mini", upstream gpt-4.1-mini) untuk `/api/chat/completions`.

- Alur: `POST https://quillbot.com/api/ai-chat/chat/conversation/<uuid-v4-acak>` body `{message:{content,prompt:{id:"ai-chat/omnibox",version:1}}, context:{...,userDialect:"en-us",apiVersion:2}, origin:{name:"ai-chat.chat",url:"https://quillbot.com"}}` → respons NDJSON: `{"content":"...","type":"content"}` (teks), `{"type":"usage"}` (model/token).
- **Penting:** fetch polos (undici) dari Node DIBLOKIR Cloudflare 403 "Just a moment" (deteksi TLS/HTTP2 fingerprint, tak mempan walau pakai cookie+UA browser). Solusi: lib **cloudscraper** (dependency lama yang menganggur) yang mengeksekusi JS challenge CF via `node:vm` — serverless-safe.
- UUID conversation di-generate acak client-side; server bikin konversi baru otomatis (terverifikasi 2 chat = 2 UUID beda).
- **Kuota anon terbatas**: beberapa pesan per identitas/IP -> `429 {"statusCode":429,"message":"Sign in to continue"}`. Mitigasi di lib: retry otomatis (maks 4) dengan rotasi identitas (jar cookie baru via `cloudscraper.defaults({jar: cloudscraper.jar()})`) + spoof `X-Forwarded-For` acak (backend quillbot membacanya). Setelah mitigasi, 6/6 sukses beruntun di production.
- Adaptor buffered penuh (pola `gemini-3.6-flash`/`fakeSingleChunkStream`) karena transport cloudscraper tak streaming. Uji: `node scripts/test-quillbot-web.mjs`.

## Konvensi Diet (AGENTS.md)

- Komunikasi wajib bahasa Indonesia.
- Baca `CODEBASE.md` sebelum mulai; jaga tetap aktual, prune info usang.
- Fokus pada tugas; tanpa perombakan di luar cakupan.
- Verifikasi hasil dengan deploy ke Vercel Production.
- Dilarang `git commit`/`git push` dan `npm run start`/`dev`/`lint` kecuali diminta eksplisit.

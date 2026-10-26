# Na-api Go backend

Backend HTTP API Na-api, ditulis ulang dari handler Next.js ke Go. Frontend
Next.js meneruskan seluruh request `/api/*` ke service ini (lihat
`app/api/[...path]/route.js` dan `config.json` di root repo).

## Menjalankan

```bash
cd backend
go run ./cmd/server          # memakai config.json di root (port 8081)
# atau
go build -o bin/server ./cmd/server && ./bin/server
```

Docker:

```bash
docker build -t na-api-backend backend
docker run --rm -p 8080:8080 --env-file .env.local na-api-backend
```

## Deploy ke Koyeb

Push ke `main` yang mengubah `backend/**` (atau jalankan manual) memicu
`.github/workflows/deploy-backend.yml`: workflow menjalankan
`go build/vet/test`, lalu `.github/scripts/deploy-koyeb.mjs` membuat App/Service
Koyeb (pertama kali) atau memperbarui Service dan menunggu deployment `HEALTHY`.

Default: app `na-api`, service `backend`, region `fra`, instance `free` (satu-satunya
region untuk instance gratis), port `8080`, health check `/healthz`, build dari
repo GitHub publik dengan workdir `backend` dan `Dockerfile` yang sama.

Secret/variable yang dipakai workflow:

| Nama | Jenis | Wajib | Fungsi |
| --- | --- | --- | --- |
| `KOYEB_API_TOKEN` | secret | ya | Token API Koyeb (Settings → API). |
| `PURUBOY_PG_URL` | secret | tidak | Diteruskan sebagai env runtime backend. |
| `PURUBOY_ADMIN_KEY` | secret | tidak | Diteruskan sebagai env runtime backend. |
| `GH_API_TOKEN` | secret | tidak | Diteruskan sebagai env `GITHUB_TOKEN` (rate limit API GitHub). |
| `CF_PROXY` | variable | tidak | Override proxy Cloudflare. |
| `KOYEB_APP_NAME`, `KOYEB_SERVICE_NAME`, `KOYEB_REGION`, `KOYEB_INSTANCE_TYPE`, `KOYEB_PORT`, `KOYEB_WORKDIR`, `KOYEB_DOCKERFILE` | variable | tidak | Override default di atas. |

Setelah deploy, catat URL backend dari job summary lalu set `BACKEND_URL` di
Vercel (atau `backendUrl` di `config.json`) ke URL tersebut.

## Konfigurasi

Bersama frontend, backend membaca `config.json` di root repo:

```json
{
  "backendUrl": "https://na-api-nue-api-e7bfd3f4.koyeb.app",
  "port": 8081,
  "requestTimeoutMs": 55000
}
```

- `backendUrl` — URL yang dipakai frontend untuk proxy. Nilai default mengarah ke
  backend Koyeb; set `BACKEND_URL=http://localhost:8081` saat debugging lokal.
- `port` — port listen backend.
- `requestTimeoutMs` — batas waktu panggilan upstream.

Environment variable menimpa file konfigurasi:

| Variable | Fungsi |
| --- | --- |
| `PORT` | Port listen (Docker memakai `8080`). |
| `CONFIG_PATH` | Lokasi `config.json` alternatif. |
| `PURUBOY_PG_URL` | PostgreSQL untuk blogs, chat board, temp store, dan settings. |
| `PURUBOY_ADMIN_KEY` | Kunci endpoint `/api/admin/*`. |
| `GITHUB_TOKEN` | Menaikkan rate limit GitHub API (pages, user-scripts, skills). |
| `CF_PROXY` | Proxy fallback Cloudflare (default `vercel-api-beta-red.vercel.app`). |
| `BACKEND_URL` | Override `backendUrl` khusus untuk frontend Next.js. |

## Struktur

```
cmd/server/            # entrypoint + middleware (CORS, rate limit, cache header)
internal/config/       # config.json + env
internal/httpx/        # helper JSON/SSE/NDJSON/query
internal/webclient/    # HTTP client upstream + UA default
internal/htmlx/        # helper parsing HTML (golang.org/x/net/html)
internal/cache/        # TTL cache in-process
internal/db/           # pgx pool opsional
internal/settings/     # tabel settings (auto chain, featured)
internal/aimodels/     # registry model tunggal
internal/ai/           # /api/models, /api/chat/completions, /api/search/web
internal/deepseek/     # /api/deepseek/*
internal/downloader/   # /api/downloader/*, /api/search/soundcloud, /api/play/soundcloud
internal/reader/       # /api/komiku/*, /api/dramabox/*
internal/purtv/        # /api/purtv/*
internal/tools/        # /api/tools-image/*, /api/text2image, /api/text2video, /api/uploader
internal/content/      # blogs, chat, temp, pages, user-scripts, admin
internal/agenttools/   # agent-tools/*, chess/maia, _diag
```

## Endpoint

Semua path lama dipertahankan. Ringkasan per paket ada di tabel struktur di
atas; dokumentasi parameter tetap tersedia di halaman `/docs` (sumber JSDoc
berada di `legacy/next-api/`).

## Catatan migrasi

- `legacy/next-api/` menyimpan handler Next.js lama. Handler tersebut tidak
  dipakai lagi oleh runtime Next.js (hanya dibaca `scripts/rebuild-docs.js`
  untuk menghasilkan `public/docs.json`).
- Endpoint streaming mempertahankan format lama: SSE untuk chat/text2image dan
  NDJSON untuk `tools-image`.
- Keterbatasan yang diketahui:
  - Provider EaseMate dan QuillBot belum diporting (butuh WASM/cloudscraper);
    pemanggilan langsung mengembalikan 502 dengan pesan jelas, dan rantai
    model `auto` melewatinya.
  - YouTube memakai sumber `vidssave.com`; jalur sandbox E2B tidak diporting.
  - Perhitungan token chat memakai aproksimasi, bukan tokenizer BPE.
- Rate limit 100 request/menit/IP, header CORS, dan aturan cache (`no-store`
  untuk chat/temp/tools/admin dan 7 hari untuk endpoint publik) dipindahkan
  dari `middleware.js` ke middleware Go.

## Pengujian

```bash
go test ./...
go vet ./...
```

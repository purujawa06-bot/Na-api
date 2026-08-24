# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Apa ini

PuruBoy API — REST API publik gratis berbasis Next.js 14 (App Router), di-deploy ke Vercel (`puruboy-api.vercel.app`). Kategori endpoint: AI (chat/image/TTS via reverse-engineering web app pihak ketiga), Downloader, Anime, Search, Tools, DramaBox. Bahasa kode & komentar: Indonesia.

## Perintah

```bash
npm run dev              # dev server di port 8080
npm run build            # next build
npm run build:full       # generate docs.json dulu, lalu build (dipakai Vercel)
node scripts/rebuild-docs.js   # regenerate public/docs.json setelah menambah/mengubah JSDoc route
node scripts/patch-routes.js   # auto-inject errorLogger ke semua route API
```

Tidak ada test suite formal. Untuk menguji service `lib/*.js` secara langsung, buat skrip `.mjs` sementara di `scripts/` dan jalankan dengan `node` — hapus setelah selesai. Catatan: file `scripts/test-*.mjs` ada di `.gitignore`.

## Arsitektur

**Pola endpoint:** logika bisnis hidup di `lib/<nama>.js` (service murni, tanpa Next.js); route handler tipis di `app/api/<kategori>/<nama>/route.js` hanya memvalidasi input, memanggil service, dan membungkus response `{ success, ... }`. Route diekspor dengan `export const dynamic = 'force-dynamic'`, `runtime = 'nodejs'`, dan `maxDuration = 60` bila butuh waktu lama.

**Dokumentasi auto-generated:** JSDoc di atas tiap route handler (`@title`, `@summary`, `@description`, `@method`, `@path`, `@param`, `@choice`, `@response`, `@example`) dipindai `lib/docsService.js` menjadi `public/docs.json` yang dikonsumsi halaman `/docs`. Menambah route tanpa JSDoc lengkap akan gagal validasi docs. Setelah mengubah JSDoc, jalankan `node scripts/rebuild-docs.js`.

**Reverse-engineering upstream (pola penting proyek ini):** banyak service adalah klien HTTP murni ke situs pihak ketiga (Gemini, DeepSeek, TikTok/ssstik, Instagram, DramaBox) — sengaja tanpa headless browser agar jalan di Vercel. Alur kerjanya:
1. Sniff trafik browser via CDP (`scripts/sniff-*.mjs`, butuh Chrome/Brave dijalankan dengan remote debugging port 9222, atau env `CDP_URL`) untuk menemukan request internal.
2. Tulis ulang request tersebut sebagai fetch murni di `lib/`.
3. Skrip eksplorasi lain (`scripts/*-probe.mjs`, `scripts/test-*.mjs`, `get-deepseek-token.mjs`, dll.) dipakai saat investigasi; lihat komentar header tiap service untuk format protokol hasil reverse-eng.

Upstream sering berubah (blokir IP datacenter, ubah protokol, minta login). Saat endpoint produksi error, bandingkan perilaku lokal vs Vercel dulu — HTTP 403 dari lokal-OK/Vercel-blok artinya IP datacenter diblokir dan perlu backend alternatif. Beberapa layanan punya fallback berlapis (lihat `lib/instagram.js`: utama kkinstagram embed-proxy, cadangan instasave.website).

**Infrastruktur lintas-cutting:**
- `middleware.js` (Edge): rate limit in-memory + intercept semua response API non-200 → laporan Telegram.
- `instrumentation.js`: hook `unhandledRejection`/`uncaughtException` global → `lib/errorLogger.js` (Telegram).
- `lib/db.js`: pool PostgreSQL dari env `PURUBOY_PG_URL`; jika kosong, ekspor dummy pool yang throw dengan pesan jelas (fitur DB opsional).
- CORS terbuka (`*`) untuk semua `/api/*` via header di `next.config.js`.

## Environment variables

- `PURUBOY_PG_URL` — PostgreSQL (Neon/Supabase); opsional.
- `PURUBOY_ADMIN_KEY` — auth panel admin.
- `GEMINI_COOKIES` — cookie akun Google untuk `lib/gemini-web.js`.
- `DEEPSEEK_TOKEN`, `DEEPSEEK_LOCALE`, `DEEPSEEK_TZ_OFFSET` — klien DeepSeek web.
- `CDP_URL` — alamat Chrome DevTools Protocol untuk skrip sniffing (default `http://127.0.0.1:9222`).
- `GITHUB_TOKEN` — akses GitHub API.

## Konvensi

- Response sukses: `{ success: true, source?, ...data }`; gagal: `{ success: false, error }` dengan status 400 (input) / 502 (upstream).
- Komentar dan pesan error dalam bahasa Indonesia; jelaskan alur reverse-engineering di komentar header file service.
- Deployment: push ke `main` → Vercel deploy otomatis (`vercel:build` menjalankan generate-docs + build). Endpoint produksi dapat dites dengan curl setelah deploy.

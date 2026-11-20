# Plan: Purulocal all-builtin + hapus plugin/noise-remover endpoints + endpoint ffmpeg

## Scope (dari permintaan)
- [ ] Hapus semua plugin puruLocal, pindahkan ke built-in, hapus page Plugin (UI+API bot) karena semua built-in.
- [ ] `.removens`: reverse engineering nirkyy langsung di dalam puruLocal (CDP), bukan via endpoint na-api.
- [ ] Hapus endpoint na-api: `/api/tools/noise-remover` (+docs/JSDoc) dan endpoint plugin purulocal (`/api/purulocal/plugins`, `/api/purulocal/plugins/exec`).
- [ ] Endpoint baru na-api `/tools/ffmpeg` (konversi via ffmpeg) + sediakan docs (JSDoc + rebuild docs).
- [ ] Commit, push, monitoring hingga hijau.

## Rencana detail (tracking)

### 1) Analisis & persiapan
- [x] Petakan server plugin purulocal (na-api): ai(.ai), play(.play), tt/tiktok(.tt), brat(.brat), removens(.removens) di `backend/internal/purulocal/plugins.go`.
- [x] Petakan sistem plugin bot: `purulocal-bot/go_backend/internal/bot/plugins.go`, manager, cmd_menu, web API, UI Plugin page.
- [x] Petakan endpoint noise-remover na-api: `backend/internal/tools/noiseremover.go`, register, JSDoc `legacy/next-api/tools/noise-remover/route.js`.
- [x] Cek dependensi bot: `coder/websocket` ada di go.mod bot (bisa CDP).

### 2) Bot puruLocal: plugin â†’ built-in + hapus sistem plugin & page Plugin
- [x] Tambah builtin `.ai` (cmd/ai.go): panggil na-api `/api/chat/completions` (SSE stream), format reply WA, dukung riwayat+compact (pindah logika dari manager/plugin exec).
- [x] Tambah builtin `.play` (cmd/play.go): panggil na-api `/api/play/soundcloud` (+ proxy audio url).
- [x] Tambah builtin `.tt`/`.tiktok` (cmd/tt.go): panggil na-api `/api/downloader/tiktok`.
- [x] Tambah builtin `.brat` (cmd/brat.go): hasilkan sticker via na-api `/api/tools/brat`.
- [x] Ubah `.removens` jadi reverse-engineering nirkyy langsung di bot (CDP ke nirkyy-a.hf.space, alur gradio uploadâ†’call/denoiseâ†’SSEâ†’download, konversi ffmpeg bila tersedia; fallback aman). Hapus ketergantungan ke endpoint noise-remover na-api.
- [x] Hapus sistem plugin bot: `plugins.go` (PluginStore/exec/fetch), referensi di `manager.go` (field, load, resolve/handle plugin, .ai plugin path, ListAllFeatures plugin), `cmd_menu.go`, `cmd_adapters.go` bila terkait, `export.go` bila terkait.
- [x] Hapus API plugin di web server bot (`internal/web/server.go`): routes/handlers plugin (list/available/install/remove/toggle) + panggilan terkait.
- [x] Hapus page Plugin di UI (`ui/src/App.jsx`, nav PAGES, state/logic/render plugin) dan hapus API plugin di `ui/src/api.js` jika ada.
- [x] Update fitur/menu/listing agar builtin baru tampil benar (AI/Music/Downloader/Sticker/Audio) & bersihkan jejak "plugin".
- [x] Bersihkan tipe/field plugin/jejak plugin tersisa di model/konfig jika ada; pastikan build bot hijau.

### 3) na-api: hapus endpoint noise-remover & plugin purulocal
- [x] Hapus `backend/internal/tools/noiseremover.go` dan route `POST /api/tools/noise-remover` dari `backend/internal/tools/register.go`.
- [x] Hapus JSDoc `legacy/next-api/tools/noise-remover/route.js`.
- [x] Hapus endpoint plugin purulocal: `GET /api/purulocal/plugins`, `POST /api/purulocal/plugins/exec` dari `backend/internal/purulocal` (pertahankan update-manifest bila bukan "plugin"; evaluasi) dan sesuaikan register/main.
- [x] Pertahankan package `backend/internal/purulocal` untuk update-manifest (bukan endpoint plugin), hapus & lepas dari `cmd/server/main.go`.
- [x] Bersihkan referensi/noise-remover & plugin purulocal di docs/sumber terkait (middleware, dll.) di docs/sumber lain yang relevan.

### 4) na-api: endpoint baru `/tools/ffmpeg` + docs
- [x] Implementasi handler ffmpeg (konversi media via ffmpeg, multipart file + opsi format/argumen aman) + register route `/api/tools/ffmpeg` (POST, NDJSON/hasil URL konsisten).
- [x] Tambah JSDoc `legacy/next-api/tools/ffmpeg/route.js` (`@title @summary @method @path @example @param` sinkron).
- [x] Rebuild docs: `node scripts/rebuild-docs.js` â†’ `public/docs.json` valid & memuat `/tools/ffmpeg`, tanpa noise-remover.

### 5) Verifikasi, commit, push, monitoring
- [ ] Build/vet/test backend: `cd backend && go build ./... && go vet ./... && go test ./...` (env dummy PG/admin).
- [ ] Build bot: `cd purulocal-bot/go_backend && go build ./... && go vet ./...`.
- [ ] `node scripts/rebuild-docs.js` sukses.
- [ ] Commit semua perubahan relevan (tidak commit secret/>5MB/unrelated bila tidak diminta), push.
- [ ] Monitoring CI/deploy (gh run) hingga hijau; catat bukti.

## Catatan keputusan
- "Plugin semuanya" (na-api) diartikan endpoint plugin purulocal (list/exec); update-manifest dipertahankan jika terpisah dari fungsi plugin (akan diputuskan saat implementasi & dicatat).
- `.ai/.play/.tt/.brat` sebagai builtin bot tetap memanggil endpoint publik na-api yang relevan (bukan endpoint plugin purulocal).
- `.removens` diimplementasikan native di bot (CDP nirkyy + konversi ffmpeg jika ada), tanpa endpoint noise-remover na-api.
- Perbaikan `bytes` redeclare (CDP JS) di noiseremover.go menjadi moot jika endpoint dihapus; perubahan tak terkait lain tidak diganggu kecuali perlu.

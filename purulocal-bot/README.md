# puruLocal Bot

Aplikasi bot WhatsApp bernama **puruLocal Bot** dengan arsitektur Flutter (APK) + backend Go (`whatsmeow`).

> **Penting:** sesi bot **berjalan lokal di perangkat (HP)**, bukan di backend na-api. Backend Go berjalan di device sebagai service lokal; na-api hanya menyediakan halaman/blog untuk info & download APK (experiment).

## Fitur
- UI sederhana (Flutter/WebView): input **Nama Owner**, **Nomor Owner**, **Nomor Bot** (boleh sama), toggle **Bot tidak bisa chat diri sendiri**, tombol **Connect with Pairing Code** dan **Connect with QR**.
- Backend bot WhatsApp memakai library Go [whatsmeow](https://github.com/tulir/whatsmeow), menyimpan sesi lokal (`store.db`) di storage privat perangkat.
- Auto-update ala Flutter APK (OTA): app cek manifest versi, unduh APK baru, verifikasi SHA-256, lalu minta izin install.

## Struktur
- `flutter_app/` — Aplikasi Flutter (UI, konfigurasi, auto-update, bridge ke backend lokal).
- `go_backend/` — Service bot WhatsApp (whatsmeow), HTTP API lokal untuk pairing/QR/status/config. Menyertakan UI web sederhana (`internal/web/static/index.html`) yang bisa dibuka di WebView/localhost.
- `assets/` — Icon/logo (menggunakan favicon na-api).
- `docs/` — Dokumentasi arsitektur auto-update.

## Arsitektur Auto-Update (seperti Flutter APK)
1. **Version manifest** di-host (JSON): `{ "version": "1.0.1", "build": 2, "url": "https://.../puruLocalBot.apk", "notes": "...", "sha256": "..." }`.
2. Saat app dibuka / interval, Flutter memanggil `UpdateService.check()` membandingkan `buildNumber` lokal vs manifest.
3. Jika ada versi baru: tampilkan dialog changelog → unduh APK ke storage app dengan progress.
4. Verifikasi checksum (SHA-256) lalu trigger install via `PackageInstaller`/intent `ACTION_VIEW` (`application/vnd.android.package-archive`) dengan `FileProvider`.
5. Butuh permission `REQUEST_INSTALL_PACKAGES` dan sumber tidak dikenal sesuai Android version.

Detail lihat `docs/auto-update.md`.

## Konfigurasi Dasar Bot
- `owner_name`: nama owner.
- `owner_number`: nomor owner (format internasional, tanpa +), contoh `628123456789`.
- `bot_number`: nomor bot (boleh sama dengan owner).
- `block_self_chat`: jika aktif, bot mengabaikan pesan dari nomor bot sendiri.

## Koneksi WhatsApp
- **QR**: backend generate QR login whatsmeow, Flutter render QR dari payload/string.
- **Pairing Code**: masukkan nomor, backend meminta pairing code ke WhatsApp dan menampilkannya di UI.

## Build APK
> **Jangan build APK di environment lokal ini (berisiko OOM).** Build dilakukan via **GitHub Actions**.

- Workflow: `.github/workflows/build-purulocal-apk.yml`
- Trigger: `workflow_dispatch` (manual / via GitHub API) atau push ke `main` yang mengubah `purulocal-bot/**`.
- Output: artifact `puruLocalBot-apk` (`app-release.apk` + `.sha256`), dan opsional GitHub Release (prerelease/experiment) jika input `release_tag` diisi.
- Contoh trigger via GitHub API (Actions workflow dispatch): `POST /repos/{owner}/{repo}/actions/workflows/build-purulocal-apk.yml/dispatches` dengan body `{"ref":"main"}` (butuh token dengan permission Actions).

### Backend Go (dev lokal / service di perangkat)
```bash
cd go_backend
go mod tidy
go run ./cmd/purulocal
```
UI lokal: `http://127.0.0.1:8787`. Sesi disimpan lokal di `data/store.db`.

> Integrasi penuh backend whatsmeow ke dalam APK Android (gomobile/service foreground, bundling binary) perlu penyesuaian toolchain Android/NDK di workflow; workflow saat ini menyiapkan build APK Flutter (UI + auto-update + bridge API lokal) dan memverifikasi backend Go build. Sesuaikan langkah gomobile/bundling sesuai kebutuhan.

## Catatan
- WhatsApp/whatsmeow bersifat tidak resmi; gunakan dengan risiko sendiri dan patuhi ketentuan layanan.
- Simpan sesi/database (`store.db`) di storage privat app.
- Jangan commit token/secret.

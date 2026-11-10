# Go Backend (whatsmeow) - puruLocal Bot

Service lokal yang berjalan di perangkat (HP), bukan di backend na-api.

## Jalankan (dev/desktop)
```bash
cd go_backend
go mod tidy
go run ./cmd/purulocal
```
- UI/API lokal: `http://127.0.0.1:8787`
- Konfigurasi: `config.json` (default, bisa diubah via env `PURULOCAL_CONFIG`)
- Data/sesi WhatsApp: folder `data/store.db` (env `PURULOCAL_DATA`)
- Bind address: env `PURULOCAL_ADDR` (default `127.0.0.1:8787`)

## Endpoint lokal
- `GET /api/status` — status koneksi/login + config
- `GET|POST /api/config` — baca/simpan konfigurasi (owner, nomor bot, block self chat)
- `POST /api/connect/qr` — minta QR login
- `POST /api/connect/pair` — minta pairing code `{ "phone": "628..." }`
- `POST /api/disconnect`, `POST /api/logout`

## Catatan
- `block_self_chat`: jika aktif, event pesan dari diri sendiri (`IsFromMe`) diabaikan handler.
- Build untuk Android bisa via `gomobile bind` atau cross-compile sesuai arsitektur, lalu dijalankan sebagai service lokal yang di-bridge oleh Flutter. Sesuaikan dengan toolchain/apk tools yang tersedia di environment-mu.
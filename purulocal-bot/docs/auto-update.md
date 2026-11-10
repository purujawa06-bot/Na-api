# Arsitektur Auto-Update puruLocal Bot (Flutter APK)

Mirip mekanisme OTA/update mandiri pada APK Flutter (di luar Play Store) atau in-app update: app secara berkala mengecek versi terbaru, mengunduh APK, dan memasang update.

## Komponen
1. **Update Manifest (remote)** — file JSON statis di server/CDN:
```json
{
  "app": "puruLocalBot",
  "versionName": "1.1.0",
  "buildNumber": 3,
  "minBuild": 1,
  "apkUrl": "https://example.com/releases/puruLocalBot-1.1.0.apk",
  "sha256": "<sha256-hex>",
  "force": false,
  "changelog": "- Perbaikan pairing\n- Stabilitas koneksi"
}
```

2. **UpdateService (Flutter/Dart)** — `lib/services/update_service.dart`
- Ambil manifest (`http.get`).
- Bandingkan `buildNumber` manifest vs `package_info_plus` build number lokal.
- Jika `force` atau build lebih baru: kembalikan `UpdateInfo`.

3. **Downloader** — unduh APK ke `getExternalFilesDir`/app cache dengan progress stream (`dio`/`http` chunk) dan tampilkan progress UI.

4. **Verifier** — hitung SHA-256 file unduhan, cocokkan dengan manifest.

5. **Installer** — minta izin `REQUEST_INSTALL_PACKAGES`, gunakan `FileProvider` + intent install:
- `content://` URI ke APK.
- `Intent.ACTION_VIEW` / `PackageInstaller` session.
- Setelah install, sistem menggantikan APK (signature harus sama).

## Flow
```
App start/resume -> fetch manifest -> compare build
  -> no update: lanjut
  -> update tersedia: dialog (changelog, Later/Update, Force jika wajib)
      -> download APK + progress
      -> verify sha256
      -> request install permission jika perlu
      -> launch installer
```

## Keamanan
- Selalu verifikasi `sha256` dan tanda tangan package sama.
- Gunakan HTTPS untuk manifest dan APK.
- `minBuild` untuk memaksa update jika ada breaking change.
- Jangan auto-install tanpa konfirmasi user kecuali kebijakan force jelas.

## Konfigurasi di app
- `updateManifestUrl` disimpan di config (default bisa dikosongkan = auto-update off).
- Toggle "Cek update otomatis".
- Tombol "Cek Update" manual di Settings.

## Catatan Android
- Android 8+: butuh izin install unknown apps per-app.
- Android 10+: scoped storage, simpan APK di direktori app.
- Play Store build biasanya pakai In-App Updates API; OTA mandiri ini untuk distribusi APK langsung.

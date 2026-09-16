# PuruBoy API 🚀

[![Next.js](https://img.shields.io/badge/Next.js-14+-black?logo=next.js)](https://nextjs.org)
[![Vercel](https://img.shields.io/badge/Deployed-Vercel-blue?logo=vercel)](https://vercel.com)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**PuruBoy API** adalah platform REST API berbasis Next.js yang menyediakan layanan AI, multimedia, pencarian konten, anime/manga, tools, dan berbagai utilitas developer dalam satu API.

> Dokumentasi interaktif tersedia di **https://puruboy-api.vercel.app/docs**. Gunakan halaman tersebut sebagai referensi endpoint, parameter, contoh request, dan response terbaru.

---

## 🌐 Quick Links

| Resource | Link |
| --- | --- |
| **Base URL** | `https://puruboy-api.vercel.app` |
| **Interactive Docs** | `https://puruboy-api.vercel.app/docs` |
| **Models Registry** | `https://puruboy-api.vercel.app/api/models` |
| **Repository** | `https://github.com/purujawa06-bot/Na-api` |

---

## ✨ Fitur Utama

### 🤖 AI
- Endpoint chat yang kompatibel dengan format OpenAI pada `/v1/chat/completions`.
- Integrasi berbagai model/provider, termasuk Gemini dan DeepSeek.
- Registry model dinamis melalui `/api/models`.
- Fitur vision, reasoning, dan text-to-image pada endpoint yang tersedia.

### 📥 Downloader & Multimedia
Menyediakan endpoint untuk berbagai kebutuhan media, termasuk:
- TikTok
- Instagram
- YouTube
- SoundCloud
- Pemrosesan gambar seperti upscaler, remove background, dan HTML-to-image

> Ketersediaan dan parameter setiap layanan dapat berubah. Selalu cek dokumentasi interaktif sebelum mengintegrasikan endpoint ke aplikasi produksi.

### 📺 Nonton & Baca
Endpoint terorganisasi untuk discovery dan pengambilan data konten:
- **DramaBox** — home, category, search, detail, dan stream.
- **Komiku** — home, pustaka, search, genre, detail, dan chapter.
- **PurTV** — home, search, genre, list, series, detail, dan schedule.

### 🔎 Discovery & Utility
- Search dan pengambilan metadata konten.
- API temporary storage untuk data berukuran besar yang bersifat sementara.
- Dokumentasi endpoint yang dihasilkan otomatis dari JSDoc route.
- Monitoring dan dashboard internal untuk kebutuhan administrasi.

---

## 📚 Contoh Penggunaan

### Mengambil daftar model

```bash
curl https://puruboy-api.vercel.app/api/models
```

### Chat Completions

Endpoint kompatibel OpenAI tersedia di:

```text
POST https://puruboy-api.vercel.app/v1/chat/completions
```

Contoh struktur request:

```bash
curl https://puruboy-api.vercel.app/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "MODEL_ID",
    "messages": [
      {"role": "user", "content": "Halo!"}
    ]
  }'
```

Ganti `MODEL_ID` dengan model yang tersedia pada endpoint `/api/models` atau lihat pilihan model langsung di dokumentasi interaktif.

---

## 🧭 Dokumentasi Endpoint

Dokumentasi API dikelompokkan secara otomatis agar endpoint lebih mudah ditemukan. Beberapa kategori utama:

| Kategori | Contoh endpoint |
| --- | --- |
| **AI** | `/v1/chat/completions`, `/api/models` |
| **Downloader** | `/api/play/soundcloud` |
| **DramaBox** | `/api/dramabox/home`, `/api/dramabox/search`, `/api/dramabox/detail` |
| **Komiku** | `/api/komiku/home`, `/api/komiku/search`, `/api/komiku/detail` |
| **PurTV** | `/api/purtv/home`, `/api/purtv/search`, `/api/purtv/series` |
| **Tools** | `/api/tools-image/upscaler`, `/api/tools-image/remove-background`, `/api/tools-image/html-to-image` |

Daftar di atas hanya contoh. **Daftar endpoint lengkap, parameter wajib/opsional, pilihan nilai, contoh request, dan response tersedia di `/docs`.**

---

## 🛠️ Tech Stack

- **Framework:** Next.js 14 — App Router
- **Runtime:** Node.js
- **Frontend:** React 18 + Tailwind CSS
- **Database:** PostgreSQL
- **AI:** Vercel AI SDK, OpenAI SDK, DeepSeek/Gemini integrations
- **Media:** Axios, Cheerio, FFmpeg, scraping utilities
- **Validation:** Zod
- **Deployment:** Vercel
- **License:** MIT

---

## 🚀 Instalasi Lokal

### 1. Clone repository

```bash
git clone https://github.com/purujawa06-bot/Na-api.git
cd Na-api
npm install
```

### 2. Konfigurasi environment

Buat file `.env.local` dan isi variabel yang dibutuhkan oleh environment lokal:

```env
PURUBOY_PG_URL="your_postgresql_url"
PURUBOY_ADMIN_KEY="your_admin_secret"
```

> Jangan commit `.env.local`, API key, password database, atau secret lainnya ke repository.

### 3. Jalankan development server

```bash
npm run dev
```

Development server menggunakan port `8080`.

Buka:

```text
http://localhost:8080
```

### 4. Build production

```bash
npm run build
```

Untuk rebuild spesifikasi dokumentasi sebelum build:

```bash
npm run build:full
```

---

## 📝 Sistem Dokumentasi Otomatis

PuruBoy API menggunakan JSDoc pada route API untuk menghasilkan spesifikasi dokumentasi secara otomatis. Informasi seperti berikut dapat diekstrak dari route:

- `@title`
- `@summary`
- `@description`
- `@method`
- `@path`
- `@param`
- `@example`
- `@guide`

Dokumentasi juga melakukan validasi terhadap kelengkapan parameter dan payload contoh ketika spesifikasi API dibuat. Karena itu, perubahan endpoint sebaiknya disertai pembaruan JSDoc route terkait.

---

## 🔐 Keamanan

- Simpan credential dan secret hanya pada environment variable.
- Jangan memasukkan API key/database URL ke source code yang di-commit.
- Endpoint internal/admin tidak ditujukan untuk dokumentasi publik.
- Untuk deployment publik, gunakan konfigurasi secret yang sesuai dengan environment Vercel/hosting.

---

## 🤝 Kontribusi

Pull request dan perbaikan dokumentasi sangat dipersilakan. Saat menambahkan atau mengubah endpoint:

1. Tambahkan atau perbarui JSDoc endpoint.
2. Pastikan `@method`, `@path`, dan parameter sesuai implementasi.
3. Sertakan `@example` yang valid untuk endpoint yang memiliki body.
4. Jalankan build dokumentasi untuk memastikan spesifikasi dapat dibuat.
5. Sertakan perubahan dokumentasi bila perilaku API berubah.

---

## 📄 Lisensi

Proyek ini didistribusikan di bawah **MIT License**. Lihat file `LICENSE` untuk informasi lengkap.

---

**PuruBoy API** — *Empowering developers with efficient tools.*

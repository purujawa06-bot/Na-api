# PuruBoy API (Na-api)

API publik gratis berbasis **Next.js** — menyediakan layanan REST API untuk AI, Downloader, Anime, Search, dan Tools. Dilengkapi dokumentasi interaktif swagger-style dengan **Try It Out**, **Auto Fill**, dan **Streaming Response**.

## 🚀 Fitur Utama

### 🤖 AI
- **Chat**: DeepSeek V4, Grok-4, GPT-4 (Typli/ChatEspanyol), Draco AI, LetMeGPT, NoteGPT, Gemini, Tsundere
- **Image Generation**: Flux, Flux V2, Ghibli Style, Vheer AI
- **Vision**: ScreenApp (analisis gambar via Gemini)
- **Text-to-Speech**: Svara, Aitwo (Bahasa Indonesia)
- **Text Processing**: Translapp (Translate, Paraphrase, Summarize)

### 📥 Downloader
- YouTube (Video/Audio), TikTok (No WM — `/api/downloader/tiktok`, via ssstik.io), Instagram, Facebook, X/Twitter, SoundCloud, Spotify
- DramaBox (katalog drama pendek — `/api/dramabox/home`, tanpa browser, via dramabox.com)

### 🎬 Anime
- Oploverz Streaming, MyAnimeList (Search, Popular, Ongoing, Genre), Samehadaku

### 🔍 Search
- Yahoo, YouTube, SoundCloud, Pinterest, Lahelu, Lyrics, Suggestions

### 🛠️ Tools
- Remove Background, Upscale, Colorize, QRIS Generator, TikTok Chart, AI Blog System

### 📖 Dokumentasi Interaktif
- **Try It Out**: langsung coba endpoint dari browser
- **Auto Fill**: isi parameter otomatis dari contoh kode
- **Live Streaming**: response SSE tampil real-time
- **Copy cURL/JS**: contoh kode siap pakai
- **Parameter Chooser**: pilih opsi dengan tombol, bukan input teks
- **Dark Mode**: UI gelap ramah mata

## 🌟 Top Contributors

| Avatar | Nama | Peran |
|--------|------|------|
| <img src="https://avatars.githubusercontent.com/u/7004559855?v=4" width="48" height="48" style="border-radius:50%"> | **Mas Puru** | Founder & Developer |

### Special Thanks
- **You** — for using and supporting this project! 🙌

---

## 🛠️ Teknologi

- **Next.js 14** (App Router) + **Tailwind CSS**
- **PostgreSQL** (via `pg`)
- **Dokumentasi auto-generated** dari JSDoc di route handler (`@title`, `@summary`, `@description`, `@method`, `@path`, `@param`, `@example`, `@choice`)
- **Axios & Fetch**, **IndexedDB** (chatroom), **ID-based Sticker System**

## ⚙️ Prasyarat

- Node.js ≥18
- PostgreSQL (Neon.tech / Supabase gratis)

## 📦 Instalasi Lokal

```bash
git clone https://github.com/purujawa06-bot/Na-api.git
cd Na-api
npm install
```

Buat `.env.local`:

```env
PURUBOY_PG_URL="postgres://user:password@host:port/db?sslmode=require"
PURUBOY_ADMIN_KEY="password_admin_kamu"
```

Jalankan:

```bash
npm run dev
```

Buka **http://localhost:3000**.

## 📂 Struktur

```
app/               → Halaman & API Routes
  api/             → Endpoint REST (Route Handlers + JSDoc sumber docs)
  docs/            → Dokumentasi interaktif
  chat/            → Chatroom komunitas
components/        → React UI komponen
lib/
  *.js             → Service/logika endpoint (ssstik.js, gemini-web.js, chatService.js, dll.)
public/            → Aset statis + docs.json (hasil generate)
```

### Cara nambah endpoint baru

1. Buat service/logika di `lib/<nama>.js`.
2. Buat `app/api/<kategori>/<nama>/route.js` → tulis JSDoc (`@title`, `@summary`, `@description`, `@method`, `@path`, `@param`, `@example`) lalu import service & kirim response.
3. Generate docs: `node scripts/rebuild-docs.js` (menghasilkan `public/docs.json`).

## 🚀 Deployment

**Vercel** (recommended):

```bash
git push
# Import di Vercel, set env vars, deploy
```

## 📝 Lisensi & Author

**PuruBoy** — Open source untuk pembelajaran.

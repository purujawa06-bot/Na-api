# PuruBoy API (Na-api)

API berbasis **Next.js (App Router)** yang menyediakan layanan AI (termasuk OpenAI-compatible `/v1/chat/completions`), Downloader, DramaBox, Search, Blogs, dan Admin management.

## 🚀 Fitur & Endpoint Utama

### 🤖 AI
- **OpenAI Compatible**: `/api/chat/completions` (support provider web, DSML sanitizing, streaming SSE)
- **DeepSeek Web Direct**:
  - `/api/deepseek/instant`
  - `/api/deepseek/reasoning`
  - `/api/deepseek/vision`
- **Models List**: `/api/models`

### 📥 Downloader & Play
- **TikTok**: `/api/downloader/tiktok` (via ssstik.io)
- **Instagram**: `/api/downloader/instagram` (via instasave.website)
- **YouTube**: `/api/downloader/youtube` (via vidssave / e2b)
- **SoundCloud**: `/api/downloader/soundcloud` & `/api/play/soundcloud`

### 🎬 DramaBox
- `/api/dramabox/home`
- `/api/dramabox/category`
- `/api/dramabox/search`
- `/api/dramabox/detail`
- `/api/dramabox/stream`

### 🔍 Search
- `/api/search/soundcloud`

### 📝 Blogs & Chat
- **Blogs**: `/api/blogs` & `/api/blogs/[id]`
- **Chat**: `/api/chat`

### 🛠️ Admin & System
- **Admin**: `/api/admin/login`, `/api/admin/featured`, `/api/admin/aichain`
- **Diag**: `/api/ _diag/upstream`
- **Temp Storage**: `/api/temp/[id]`
- **Pages / System Settings**: `/api/pages`

---

## 🛠️ Teknologi

- **Next.js 14** (App Router) + **Tailwind CSS**
- **PostgreSQL** (via `pg`)
- **Dokumentasi Auto-Generated**: JSDoc di route handler diproses via `scripts/rebuild-docs.js` (`public/docs.json`)
- **Provider Integrations**: DeepSeek Web, Gemini Web, NoteGPT, EaseMate WASM/Web, SSSTik, InstaSave, SoundCloud, Dramabox

---

## ⚙️ Prasyarat

- Node.js ≥18
- PostgreSQL (Neon.tech / Supabase / PostgreSQL local)

---

## 📦 Instalasi & Penggunaan Lokal

1. Clone repository:
   ```bash
   git clone https://github.com/purujawa06-bot/Na-api.git
   cd Na-api
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Buat file `.env.local`:
   ```env
   PURUBOY_PG_URL="postgres://user:password@host:port/db?sslmode=require"
   PURUBOY_ADMIN_KEY="password_admin_kamu"
   ```

4. Jalankan mode development:
   ```bash
   npm run dev
   ```
   Buka `http://localhost:3000`.

---

## 📂 Struktur Project

```
app/               → Next.js App Router (Pages, UI, & API Routes)
  api/             → Endpoint REST API & OpenAI Compatible proxy
  docs/            → UI Dokumentasi API interaktif
components/        → Komponen UI React
lib/               → Core services (ai-provider-web, dsml-sanitizer, dramabox, soundcloud, dll.)
public/            → Aset statis & docs.json
scripts/           → Script utility (rebuild-docs.js)
utils/             → Helper functions
```

### Tambah / Update Documentation

Setelah mengubah route JSDoc, jalankan:
```bash
node scripts/rebuild-docs.js
```

---

## 🌟 Author

**Mas Puru** — purujawa06-bot
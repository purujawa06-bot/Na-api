# Na-api 🚀

[![Next.js](https://img.shields.io/badge/Next.js-14+-black?logo=next.js)](https://nextjs.org)
[![Vercel](https://img.shields.io/badge/Deployed-Vercel-blue?logo=vercel)](https://vercel.com)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**Na-api** adalah ekosistem API modern berbasis Next.js yang dirancang untuk performa tinggi, skalabilitas, dan integrasi AI yang mulus. Menyediakan endpoint yang kompatibel dengan standar industri untuk pengolahan multimedia, pencarian konten, dan orkestrasi model AI.

---

## 🌐 Quick Links
- **Base URL**: `https://puruboy-api.vercel.app`
- **Interactive Documentation**: `https://puruboy-api.vercel.app/docs`

---

## 🛠 Fitur Utama

### 🤖 AI Ecosystem (OpenAI Compatible)
Integrasi satu pintu untuk berbagai model bahasa besar (LLM).
- **Standardized Endpoint**: `/v1/chat/completions` mendukung provider Web (Gemini, DeepSeek).
- **Dynamic Routing**: Fallback cerdas antar model via AI Models Registry.
- **Response Sanitization**: UI Artifact Sanitizer untuk memastikan output AI aman dirender.

### 📥 Multimedia & Streaming
Layanan download dan pemutaran media tanpa hambatan.
- **Social Media**: TikTok, Instagram, YouTube (High-quality & No-watermark).
- **Audio Hub**: SoundCloud Play & Download dengan metadata lengkap.
- **Short Drama**: Ekosistem DramaBox (Search, Detail, Stream).

### 🔍 Discovery & Content
- **Deep Search**: Pencarian SoundCloud dan konten blog.
- **System Monitoring**: Admin dashboard untuk metrik real-time.

---

## ⚙️ Stack Teknologi
- **Core**: Next.js 14 (App Router)
- **Styling**: Tailwind CSS
- **Database**: PostgreSQL
- **AI Integration**: Vercel AI SDK, DeepSeek Web, Gemini Web
- **Reliability**: JSDoc-powered documentation, Custom Middlewares

---

## 📦 Instalasi Lokal

1. **Clone & Install**:
   ```bash
   git clone https://github.com/purujawa06-bot/Na-api.git
   cd Na-api
   npm install
   ```

2. **Environment Setup**:
   Buat file `.env.local`:
   ```env
   PURUBOY_PG_URL="your_postgresql_url"
   PURUBOY_ADMIN_KEY="your_admin_secret"
   ```

3. **Development**:
   ```bash
   npm run dev
   ```

---

## 📄 Lisensi
Didistribusikan di bawah Lisensi MIT. Lihat `LICENSE` untuk informasi lebih lanjut.

---
**PuruBoy API** — *Empowering developers with efficient tools.*
# Na-api 🚀

Next.js API platform providing OpenAI-compatible endpoints, multimedia search, and AI response optimization.

## 🌐 Base URL
`https://puruboy-api.vercel.app`

## 🛠 Features

### 1. AI & Chat (OpenAI Compatible)
Standardized endpoints for seamless integration with existing tools.
- **POST** `/v1/chat/completions`
  - **Models**: Gemini Web, DeepSeek Web (Direct)
- **GET** `/api/models`
  - Lists currently supported and active models.

### 2. Multimedia Services
- **SoundCloud**:
  - `GET /api/search/soundcloud?q=...` - Search tracks.
  - `GET /api/play/soundcloud?q=...` - Get streaming/download URLs.
- **DramaBox**:
  - `GET /api/search/dramabox?q=...` - Discover content.
- **Blogs**:
  - `GET /api/search/blog?q=...` - Search across indexed blogs.

### 3. Core Libraries (Internal)
- **UI Artifact Sanitizer**: Automatically cleans AI-generated artifacts for safe UI rendering.
- **Gemini Share Web**: Advanced session handling for Google AI models.
- **AI Models Registry**: Centralized management for multi-provider model routing.

### 4. Admin & Monitoring
- **GET** `/api/admin`: Real-time system status and API metrics.

## 🚀 Deployment
Built with **Next.js 14+** and optimized for **Vercel**.

---
*Updated on 2026-08-26 by picoclaw (Commit: 8382501)*
# Handoff: endpoint `/api/chat/completions` (sesi 2026-08-24 yang mati)

> Dokumen ini direkonstruksi dari transkrip sesi `b1b992d8` yang stuck di loop respons-kosong.
> Semua file masih ada di working tree — dokumen ini hanya menjelaskan kondisi & sisa kerja.

## Tujuan task

Endpoint OpenAI-compatible `/api/chat/completions` agar PuruBoy API bisa dipasang sebagai backend di CLI agent lain (aider, opencode, goose, dsb.) — mendukung `system/user/assistant`, **function calling** (`tools`, `tool_calls`), dan streaming.

## Keputusan arsitektur yang sudah dibuat

1. **Library: `ai` (Vercel AI SDK v7, terpasang ^7.0.77) + `@ai-sdk-tool/parser` (^5.1.6)** — dipilih atas langchain/core karena function calling adalah kebutuhan inti dan parser ini mem-parse balasan `<tool_call>` teks jadi structured tool calls.
2. **Adapter custom `LanguageModelV4`** di `lib/ai-provider-web.js`: menyatukan DeepSeek web & Gemini web sebagai satu provider `ai`. Route cukup satu jalur `generateText/streamText`.
3. **Middleware Hermes (`hermesToolMiddleware`)**: saat request membawa `tools`, middleware menyuntik definisi tool sebagai teks ke prompt & mengonversi balasan `<tool_call>` jadi tool calls terstruktur. Middleware juga mengubah `role:"tool"` jadi teks sebelum sampai adapter — jadi adapter hanya menangani system/user/assistant teks polos.
4. **Format flatten prompt** mengikuti konvensi lama `lib/chat-deepseek-web.js`: `[System]\n...\n\nHuman: ...\n\nAI: ...`
5. Kontrak adapter: `specificationVersion:'v4'`, `doGenerate` (return `content[]`, `finishReason:{unified,raw}`, `usage`), `doStream` (emit objek `LanguageModelV4StreamPart`: `stream-start` → `reasoning-*`/`text-*` → `finish`) — **bukan** string JSON ter-encode (bug awal yang sudah diperbaiki).

## File terkait (kondisi working tree)

| File | Status |
|---|---|
| `lib/ai-provider-web.js` (245 baris) | Adapter V4 DeepSeek+Gemini, 6x ditulis selama iterasi |
| `app/api/chat/completions/route.js` (442 baris) | Route utama, 12x diedit |
| `package.json` | `ai` + `@ai-sdk-tool/parser` terpasang |

## Yang sudah terverifikasi bekerja

- ✅ Middleware Hermes bekerja sempurna dengan **model palsu**: system prompt tersuntik & tool-call ter-parse.
- ✅ Bug stream ditemukan & diperbaiki: `doStream` harus emit objek stream-part, bukan string JSON encoded.

## Titik berhenti (posisi tepat sesi mati @ 09:16 WIB)

Debugging jalur **nyata** (bukan model palsu): log dev server membuktikan
**system prompt Hermes TIDAK tersuntik** ke prompt yang dikirim ke DeepSeek.
Dugaan kuat saat itu: mode `toolChoice: 'required'` mengandalkan `responseFormat` JSON
yang diabaikan/di-drop oleh adapter. Langkah terakhir sesi adalah restart dev server
dengan env debug untuk membaca prompt yang benar-benar sampai ke upstream.

### Next steps untuk sesi baru

1. Jalankan `npm run dev` dengan env debug yang dipakai sesi lama (cek bagian bawah `lib/ai-provider-web.js` / route untuk nama env debug-nya).
2. Kirim request test dengan `tools:[...]` → verifikasi apakah middleware hermes benar-benar mencegat & menyuntik system prompt di jalur nyata.
3. Periksa interaksi `toolChoice:'required'` ↔ `responseFormat` antara SDK v7, parser, dan adapter.
4. Setelah function calling jalan: tes streaming + tes dari CLI agent sungguhan.
5. Jalankan `node scripts/rebuild-docs.js` jika JSDoc route berubah, commit.

## Catatan sesi mati itu sendiri

- Bukan context penuh, bukan error API Claude (58 kemunculan "529" di transkrip hanyalah kode proyek sendiri).
- Pola: 141 giliran asisten kosong + 8 nudge "no visible output"; `/compact` terakhir ikut gagal diam.
- Sesi besar lain (saakyy 42 giliran kosong) menunjukkan pola sama → pecah kerja per-sesi pendek & compact lebih awal.

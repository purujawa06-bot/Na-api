# Build Prompt — Transparansi

Dokumen ini menjelaskan bagaimana **prompt yang dikirim ke provider web** dibangun
oleh endpoint `/api/chat/completions`, agar kamu (client) tahu persis apa yang
diterima model.

## Pipeline

```
body.messages (OpenAI)                      contoh
  │
  ├─ role "system"/"developer" ───────────► dijadikan [System] (instruksi)
  ├─ role "user"       -> bagian percakapan
  ├─ role "assistant"  -> bagian percakapan (bisa + tool_calls)
  └─ role "tool"       -> hasil tool (dikonversi menjadi teks [hasil tool ...])
  │
  ▼
splitPrompt()            (app/api/chat/completions/route.js)
  └─ memisahkan labelsystem -> `instructions`
       sisanya -> `modelMessages` (Part LanguageModelV4)
  ▼
Vercel AI SDK            build LanguageModelV4Prompt (system + messages)
  ▼
flattenV4Prompt()        (lib/ai-provider-web.js)
  └─ satu string prompt + tagging riwayat vs pesan terakhir
  ▼
adapter web (Gemini / DeepSeek V4 / EaseMate / Gemini-share)
```

## `flattenV4Prompt` — tagging riwayat vs pesan terbaru

Supaya model jelas **pesan user mana yang harus dijawab**, bentukannya:

- Seluruh pesan **sebelum pesan user terakhir** → dibungkus `<conversation_history>`.
- Pesan **user terakhir** (+ apa pun setelahnya pada turn yang sama, mis. hasil tool)
  → dibungkus `<latest_user_message>`.
- Bila **tidak ada pesan user** (mis. transcript tool) → format datar (fallback), tanpa tag.

Contoh output untuk input multi-turn:

```
[System]
<instruksi system>

<conversation_history>
Human: halo
AI: hai
</conversation_history>

<latest_user_message>
Human: siapa presiden?
</latest_user_message>
```

Label peran: `Human:` untuk user, `AI:` untuk assistant. Pesan tool menjadi
`Human: [hasil tool "nama" (id)]: <nilai>` (dikonversi oleh middleware/`splitPrompt`).

## Catatan

- Definisi **tools (`body.tools`)** kini disertakan dalam output: tool system prompt
  diinjeksi oleh `morphXmlSystemPromptTemplate` (@ai-sdk-tool/parser, protokol XML morph).
- `tool_choice` diabaikan (emulasi tools sepenuhnya via prompt injection).

## Uji / cetak prompt mentah

Gunakan endpoint debug (tanpa memanggil provider):

```
GET /api/chat/completions/build-prompt?messages=<JSON>&tools=<JSON>
```

**Tanpa tools:**

```bash
curl -G https://puruboy-api.vercel.app/api/chat/completions/build-prompt \
  --data-urlencode 'messages=[{"role":"user","content":"halo"},{"role":"assistant","content":"hai"},{"role":"user","content":"siapa presiden?"}]' \
  -H "Accept: application/json"
```

**Dengan tools (function calling):**

```bash
curl -G "https://puruboy-api.vercel.app/api/chat/completions/build-prompt" \
  --data-urlencode 'messages=[{"role":"user","content":"Bagaimana cuaca di Jakarta?"}]' \
  --data-urlencode 'tools=[{"type":"function","function":{"name":"getWeather","description":"Cuaca sebuah kota","parameters":{"type":"object","properties":{"city":{"type":"string"}},"required":["city"]}}}]' \
  -H "Accept: application/json"
```

Respons `{ prompt, stats, stages }` berisi:

- `prompt` — string prompt mentah persis yang dikirim ke provider (termasuk tool system prompt bila ada).
- `stats` — panjang karakter & jumlah baris.
- `stages` — informasi `toolSystemPrompt`, `instructionSystem`, jumlah tools, jumlah pesan, dan role pesan terakhir.

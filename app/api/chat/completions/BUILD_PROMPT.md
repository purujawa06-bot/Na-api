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

- Definisi **tools (`body.tools`)** tidak terlihat di prompt datar: ia diinjeksi oleh
  middleware `@ai-sdk-tool/parser` (protokol Qwen3-Coder XML) sebagai teks tambahan,
  dan balasan `<tool_call>` diparsing kembali jadi `message.tool_calls`.
- `tool_choice` diabaikan (emulasi tools sepenuhnya via prompt injection).

## Uji / cetak prompt mentah

Gunakan endpoint debug (tanpa memanggil provider):

```
GET /api/chat/completions/build-prompt?messages=<JSON array OpenAI>
```

Contoh `curl`:

```bash
curl -G https://nexta-api.vercel.app/api/chat/completions/build-prompt \
  --data-urlencode 'messages=[{"role":"user","content":"halo"},{"role":"assistant","content":"hai"},{"role":"user","content":"siapa presiden?"}]' \
  -H "Accept: application/json"
```

Respons `{ prompt, stats, stages }` berisi:

- `prompt` — string prompt mentah persis yang dikirim ke provider.
- `stats` — panjang karakter & jumlah baris.
- `stages` — informasi `instructionSystem`, jumlah pesan, dan role pesan terakhir.

> Definisi tool tidak dicetak di sini (lihat bagian **Catatan** di atas).

/**
 * Adapter LanguageModelV4 (Vercel AI SDK) untuk backend chat reverse-engineered web.
 *
 * Menyatukan NoteGPT web (lib/notegpt-web.js, model "DeepSeek V4") & Gemini web
 * (lib/gemini-web.js) sebagai custom provider `ai` sehingga /api/chat/completions
 * cukup satu jalur generateText/streamText untuk semua model.
 *
 * Alur:
 *   OpenAI body -> ModelMessage -> generateText/streamText
 *     -> (bila ada tools) hermesToolMiddleware menyuntik definisi tool sebagai teks
 *        & mem-parse balasan "<tool_call>" jadi structured tool calls
 *     -> adapter ini menerima prompt SUDAH bersih (system/user/assistant berupa teks,
 *        middleware mengonversi role "tool" menjadi teks sebelum sampai sini)
 *     -> flatten jadi satu prompt string -> streamNotegpt()/generateGemini()
 *
 * Format flatten mengikuti konvensi lama lib/chat-deepseek-web.js:
 *   [System]\n...\n\nHuman: ...\n\nAI: ...
 */
import { streamNotegpt } from './notegpt-web.js';
import { generateGemini } from './gemini-web.js';

/**
 * Hanya 3 ID model publik:
 *   - 'gemini-lite' : Gemini Flash-Lite via gemini.google.com
 *   - 'deepseek-v4' : DeepSeek V4 via notegpt.io/ai-chat (tanpa login)
 *   - 'auto'        : default; coba Gemini dulu, fallback DeepSeek V4 bila error/konten kosong
 */
export const ALL_MODEL_IDS = ['gemini-lite', 'deepseek-v4', 'auto'];

function estimateTokens(text) {
  return Math.max(1, Math.ceil((text || '').length / 4));
}

function makeUsage(inputText, outputText) {
  const inTok = estimateTokens(inputText);
  const outTok = estimateTokens(outputText);
  return {
    inputTokens: { total: inTok, noCache: inTok, cacheRead: undefined, cacheWrite: undefined },
    outputTokens: { total: outTok, noCache: outTok, cacheRead: undefined, cacheWrite: undefined },
  };
}

function finish(reason) {
  return { unified: reason, raw: reason };
}

/**
 * Flatten LanguageModelV4Prompt (array pesan) jadi satu string prompt.
 * Pesan role "tool"/tool-call part hanya muncul di sini bila TANPA middleware
 * (mis. client kirim hasil tool tanpa mendefinisikan tools); diformat sebagai teks.
 */
export function flattenV4Prompt(v4Prompt = []) {
  const systemParts = [];
  const convo = [];

  for (const msg of v4Prompt) {
    // Middleware Hermes (@ai-sdk-tool/parser) mengubah pesan jadi content STRING
    // polos (bukan array part) — pakai langsung agar prompt injeksinya utuh.
    // Tanpa middleware, content berupa array part LanguageModelV4.
    let text;
    if (typeof msg.content === 'string') {
      text = msg.content;
    } else {
      const texts = [];
      const toolBits = [];
      for (const p of msg.content ?? []) {
        if (p?.type === 'text' && p.text) texts.push(p.text);
        else if (p?.type === 'reasoning' && p.text) { /* reasoning lama tidak dikirim ulang */ }
        else if (p?.type === 'tool-call') toolBits.push(`<tool_call>\n{"name": "${p.toolName}", "arguments": ${typeof p.input === 'string' ? p.input : JSON.stringify(p.input)}}\n</tool_call>`);
        else if (p?.type === 'tool-result') {
          const val = p.output?.type === 'json' ? JSON.stringify(p.output.value) : String(p.output?.value ?? '');
          toolBits.push(`[hasil tool "${p.toolName}" (${p.toolCallId})]: ${val}`);
        }
      }
      text = [...texts, ...toolBits].join('\n');
    }
    if (msg.role === 'system') systemParts.push(text);
    else convo.push(`${msg.role === 'assistant' ? 'AI' : 'Human'}: ${text}`);
  }

  if (!convo.length) return systemParts.join('\n\n');
  const lastIsAssistant = v4Prompt.at(-1)?.role === 'assistant';
  let transcript = convo.join('\n\n');
  if (lastIsAssistant && !transcript.endsWith('AI:')) transcript += '\n\nAI:';
  const preamble = systemParts.length ? `[System]\n${systemParts.join('\n\n')}\n\n` : '';
  return preamble + transcript;
}

// ---------------- NoteGPT web (DeepSeek V4) ----------------

/**
 * @param {object} opts
 * @param {string} opts.modelId ID publik ('deepseek-v4').
 */
export function createNoteGPTWebModel({ modelId = 'deepseek-v4' } = {}) {
  return {
    specificationVersion: 'v4',
    provider: 'notegpt-web',
    modelId,
    supportedUrls: {},
    async doGenerate(options) {
      const promptText = flattenV4Prompt(options.prompt);
      if (process.env.DEBUG_FLATTEN) console.error('[DEBUG flatten]\n' + promptText.slice(0, 1200));
      let content = '';
      let reasoning = '';
      for await (const d of streamNotegpt({ prompt: promptText, model: modelId })) {
        if (d.type === 'reasoning') reasoning += d.text;
        else content += d.text;
      }
      if (!content.trim() && !reasoning.trim()) throw new Error('notegpt mengembalikan konten kosong');
      const contentArr = [];
      if (reasoning) contentArr.push({ type: 'reasoning', text: reasoning });
      contentArr.push({ type: 'text', text: content });
      return {
        content: contentArr,
        finishReason: finish('stop'),
        usage: makeUsage(promptText, reasoning + content),
        warnings: [],
      };
    },
    async doStream(options) {
      const promptText = flattenV4Prompt(options.prompt);
      // CATATAN: part HARUS objek LanguageModelV4StreamPart, bukan string JSON.
      const iterator = streamNotegpt({ prompt: promptText, model: modelId });

      return {
        stream: new ReadableStream({
          async start(controller) {
            controller.enqueue({ type: 'stream-start', warnings: [] });
            const reasoningId = 'rs-0';
            const textId = 'tx-0';
            let reasoningOpen = false;
            let textOpen = false;
            let allReasoning = '';
            let allContent = '';
            try {
              for await (const d of iterator) {
                if (d.type === 'reasoning') {
                  if (!reasoningOpen) {
                    controller.enqueue({ type: 'reasoning-start', id: reasoningId });
                    reasoningOpen = true;
                  }
                  allReasoning += d.text;
                  controller.enqueue({ type: 'reasoning-delta', id: reasoningId, delta: d.text });
                } else if (d.text) {
                  if (reasoningOpen) {
                    controller.enqueue({ type: 'reasoning-end', id: reasoningId });
                    reasoningOpen = false;
                  }
                  if (!textOpen) {
                    controller.enqueue({ type: 'text-start', id: textId });
                    textOpen = true;
                  }
                  allContent += d.text;
                  controller.enqueue({ type: 'text-delta', id: textId, delta: d.text });
                }
              }
              if (reasoningOpen) controller.enqueue({ type: 'reasoning-end', id: reasoningId });
              if (textOpen) controller.enqueue({ type: 'text-end', id: textId });
              controller.enqueue({
                type: 'finish',
                usage: makeUsage(promptText, allReasoning + allContent),
                finishReason: finish('stop'),
              });
            } catch (err) {
              controller.enqueue({ type: 'error', error: err });
            } finally {
              controller.close();
            }
          },
        }),
      };
    },
  };
}

/** Stream palsu satu-chunk dari teks yang sudah utuh (dipakai Gemini & mode auto). */
function fakeSingleChunkStream(promptText, text) {
  return {
    stream: new ReadableStream({
      start(controller) {
        controller.enqueue({ type: 'stream-start', warnings: [] });
        controller.enqueue({ type: 'text-start', id: 'tx-0' });
        controller.enqueue({ type: 'text-delta', id: 'tx-0', delta: text });
        controller.enqueue({ type: 'text-end', id: 'tx-0' });
        controller.enqueue({
          type: 'finish',
          usage: makeUsage(promptText, text),
          finishReason: finish('stop'),
        });
        controller.close();
      },
    }),
  };
}

// ---------------- Gemini web ----------------

/**
 * @param {object} opts
 * @param {string} opts.modelId 'gemini-lite' (satu-satunya varian Gemini yang diekspos).
 */
export function createGeminiWebModel({ modelId = 'gemini-lite' } = {}) {
  // kode L5adhe: 0=Flash-Lite, 1=Flash (lihat lib/gemini-web.js MODELS).
  // Hanya Flash-Lite (0) yang dipakai karena varian tercepat.
  const codeByModel = { 'gemini-lite': 0 };
  return {
    specificationVersion: 'v4',
    provider: 'gemini-web',
    modelId,
    supportedUrls: {},
    async _run(options) {
      const promptText = flattenV4Prompt(options.prompt);
      const { text, modelName } = await generateGemini({ prompt: promptText, modelCode: codeByModel[modelId] ?? 0 });
      return { promptText, text, modelName };
    },
    async doGenerate(options) {
      const { promptText, text } = await this._run(options);
      return {
        content: [{ type: 'text', text }],
        finishReason: finish('stop'),
        usage: makeUsage(promptText, text),
        warnings: [],
      };
    },
    async doStream(options) {
      const { promptText, text } = await this._run(options);
      return fakeSingleChunkStream(promptText, text);
    },
  };
}

// ---------------- Auto (Gemini dulu, fallback DeepSeek V4 via NoteGPT) ----------------

/**
 * Adapter 'auto': model default endpoint. Coba Gemini Flash-Lite lebih dulu;
 * bila Gemini error ATAU mengembalikan konten kosong (bukan tool call — tool
 * call Hermes diparse dari teks, jadi teks kosong pasti bukan tool call),
 * fallback ke DeepSeek V4 (NoteGPT).
 *
 * Karena jalur Gemini selalu buffer teks penuh sebelum streaming, fallback
 * diputuskan SEBELUM satu chunk pun dikirim — klien SSE tidak melihat retry.
 *
 * @param {object} opts
 * @param {object} [opts.meta] objek output; `meta.used` diisi ID model aktual
 *                             ('gemini-lite' | 'deepseek-v4') setelah generate.
 */
export function createAutoWebModel({ meta = {} } = {}) {
  const gemini = createGeminiWebModel({ modelId: 'gemini-lite' });
  const notegpt = createNoteGPTWebModel({ modelId: 'deepseek-v4' });

  /** Jalankan Gemini; throw bila error ATAU teks kosong. */
  async function runGeminiStrict(options) {
    const { promptText, text } = await gemini._run(options);
    if (!text || !text.trim()) {
      throw new Error('gemini-lite mengembalikan konten kosong');
    }
    return { promptText, text };
  }

  function fallback(err) {
    meta.used = 'deepseek-v4';
    console.error(`[auto] Gemini gagal ("${err?.message ?? err}"), fallback ke deepseek-v4`);
    return err;
  }

  return {
    specificationVersion: 'v4',
    provider: 'auto-web',
    modelId: 'auto',
    supportedUrls: {},
    async doGenerate(options) {
      try {
        const { promptText, text } = await runGeminiStrict(options);
        meta.used = 'gemini-lite';
        return {
          content: [{ type: 'text', text }],
          finishReason: finish('stop'),
          usage: makeUsage(promptText, text),
          warnings: [],
        };
      } catch (err) {
        fallback(err);
        return notegpt.doGenerate(options);
      }
    },
    async doStream(options) {
      try {
        const { promptText, text } = await runGeminiStrict(options);
        meta.used = 'gemini-lite';
        return fakeSingleChunkStream(promptText, text);
      } catch (err) {
        fallback(err);
        // streaming asli dari upstream NoteGPT (delta per delta)
        return notegpt.doStream(options);
      }
    },
  };
}

/** Pilih adapter sesuai nama model OpenAI-style (lihat ALL_MODEL_IDS). */
export function createWebModel(modelId, { meta } = {}) {
  if (modelId === 'gemini-lite') return createGeminiWebModel({ modelId });
  if (modelId === 'auto') return createAutoWebModel({ meta });
  if (modelId === 'deepseek-v4') return createNoteGPTWebModel({ modelId });
  throw new Error(`Model tidak dikenal: ${modelId}`);
}

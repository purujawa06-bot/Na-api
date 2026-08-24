/**
 * Adapter LanguageModelV4 (Vercel AI SDK) untuk backend chat reverse-engineered web.
 *
 * Menyatukan DeepSeek web (lib/deepseek-web.js) & Gemini web (lib/gemini-web.js)
 * sebagai custom provider `ai` sehingga /api/chat/completions cukup satu jalur
 * generateText/streamText untuk semua model.
 *
 * Alur:
 *   OpenAI body -> ModelMessage -> generateText/streamText
 *     -> (bila ada tools) hermesToolMiddleware menyuntik definisi tool sebagai teks
 *        & mem-parse balasan "<tool_call>" jadi structured tool calls
 *     -> adapter ini menerima prompt SUDAH bersih (system/user/assistant berupa teks,
 *        middleware mengonversi role "tool" menjadi teks sebelum sampai sini)
 *     -> flatten jadi satu prompt string -> streamCompletion()/generateGemini()
 *
 * Format flatten mengikuti konvensi lama lib/chat-deepseek-web.js:
 *   [System]\n...\n\nHuman: ...\n\nAI: ...
 */
import { streamCompletion } from './deepseek-web.js';
import { generateGemini } from './gemini-web.js';

/** Peta model DeepSeek web -> flag thinking */
const DEEPSEEK_THINKING = {
  'deepseek-chat': false,
  'deepseek-v3': false,
  'deepseek-reasoner': true,
  'deepseek-r1': true,
};

export const ALL_MODEL_IDS = [
  ...Object.keys(DEEPSEEK_THINKING),
  'gemini-flash',
  'gemini-flash-lite',
];

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

// ---------------- DeepSeek web ----------------

/**
 * @param {object} opts
 * @param {string} opts.modelId 'deepseek-chat' | 'deepseek-reasoner' | ...
 * @param {boolean} [opts.searchEnabled]
 */
export function createDeepSeekWebModel({ modelId = 'deepseek-chat', searchEnabled = false } = {}) {
  return {
    specificationVersion: 'v4',
    provider: 'deepseek-web',
    modelId,
    supportedUrls: {},
    async doGenerate(options) {
      const promptText = flattenV4Prompt(options.prompt);
      if (process.env.DEBUG_FLATTEN) console.error('[DEBUG flatten]\n' + promptText.slice(0, 1200));
      let content = '';
      let reasoning = '';
      for await (const d of streamCompletion({
        prompt: promptText,
        thinkingEnabled: DEEPSEEK_THINKING[modelId] ?? false,
        searchEnabled,
      })) {
        if (d.type === 'reasoning') reasoning += d.text;
        else content += d.text;
      }
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
      const iterator = streamCompletion({
        prompt: promptText,
        thinkingEnabled: DEEPSEEK_THINKING[modelId] ?? false,
        searchEnabled,
      });

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

// ---------------- Gemini web ----------------

/**
 * @param {object} opts
 * @param {string} opts.modelId 'gemini-flash' | 'gemini-flash-lite'
 */
export function createGeminiWebModel({ modelId = 'gemini-flash' } = {}) {
  // kode L5adhe: 0=Flash-Lite, 1=Flash (lihat lib/gemini-web.js MODELS)
  const codeByModel = { 'gemini-flash': 1, 'gemini-flash-lite': 0 };
  return {
    specificationVersion: 'v4',
    provider: 'gemini-web',
    modelId,
    supportedUrls: {},
    async _run(options) {
      const promptText = flattenV4Prompt(options.prompt);
      const { text, modelName } = await generateGemini({ prompt: promptText, modelCode: codeByModel[modelId] ?? 1 });
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
    },
  };
}

/** Pilih adapter sesuai nama model OpenAI-style. */
export function createWebModel(modelId, { searchEnabled = false } = {}) {
  if (modelId.startsWith('gemini')) return createGeminiWebModel({ modelId });
  return createDeepSeekWebModel({ modelId, searchEnabled });
}

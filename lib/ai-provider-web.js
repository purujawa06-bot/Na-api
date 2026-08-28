/**
 * Adapter LanguageModelV4 (Vercel AI SDK) untuk backend chat reverse-engineered web.
 *
 * Menyatukan Gemini web (lib/gemini-web.js), EaseMate web (lib/easemate-web.js),
 * & Gemini share (lib/gemini-share-web.js) sebagai custom provider `ai` sehingga
 * /api/chat/completions cukup satu jalur generateText/streamText untuk semua model.
 *
 * Alur:
 *   OpenAI body -> ModelMessage -> generateText/streamText
 *     -> (bila ada tools) qwen3CoderToolMiddleware menyuntik definisi tool sebagai teks
 *        & mem-parse balasan "<tool_call>" XML jadi structured tool calls
 *     -> adapter ini menerima prompt SUDAH bersih (system/user/assistant berupa teks,
 *        middleware mengonversi role "tool" menjadi teks sebelum sampai sini)
 *     -> flatten jadi satu prompt string -> generateGemini()/streamEasemate()
 *
 * Format flatten mengikuti konvensi lama lib/chat-deepseek-web.js:
 *   [System]\n...\n\nHuman: ...\n\nAI: ...
 */
import { generateGemini } from './gemini-web.js';
import { streamEasemate } from './easemate-web.js';
import { generateGeminiShare } from './gemini-share-web.js';
import { streamPuru } from './puru-web.js';
import aiModels from './ai-models.js';

const { ALL_MODEL_IDS, AUTO_CHAIN_ALLOWED, AUTO_CHAIN_DEFAULT } = aiModels;

/**
 * ID model publik & metadatanya didefinisikan SATU tempat: lib/ai-models.js.
 * Di sini hanya:
 *   - 'auto'        : default; menyusuri rantai fallback (error/konten kosong
 *                     -> provider berikutnya; urutan diatur admin via settings,
 *                     default gemini-lite -> easemate)
 */
export { ALL_MODEL_IDS, AUTO_CHAIN_DEFAULT };

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
  let lastUserIdx = -1;

  for (const msg of v4Prompt) {
    // Middleware tool call (@ai-sdk-tool/parser, protokol Qwen3-Coder XML) mengubah
    // pesan jadi content STRING polos (bukan array part) — pakai langsung agar
    // prompt injeksinya utuh.
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
    if (msg.role === 'system') { systemParts.push(text); continue; }
    convo.push({ role: msg.role, text });
    if (msg.role === 'user') lastUserIdx = convo.length - 1;
  }

  if (!convo.length) return systemParts.join('\n\n');

  // Pisahkan riwayat (semua pesan lama) dari pesan user PERTANYAAN terbaru agar
  // model jelas mana yang harus dijawab. Fallback datar bila tak ada pesan user
  // (mis. transcript tool yang berakhir di role tool/assistant).
  const line = (m) => `${m.role === 'assistant' ? 'AI' : 'Human'}: ${m.text}`;
  let transcript;
  if (lastUserIdx >= 0) {
    const history = convo.slice(0, lastUserIdx).map(line).join('\n');
    // Pertukaran terkini: pesan user terakhir + apa pun setelahnya (mis. hasil
    // tool / balasan assistant pada turn yang sama) tetap dipertahankan.
    const latest = convo.slice(lastUserIdx).map(line).join('\n');
    transcript = [
      history ? `<conversation_history>\n${history}\n</conversation_history>` : '',
      `<latest_user_message>\n${latest}\n</latest_user_message>`,
    ].filter(Boolean).join('\n\n');
  } else {
    transcript = convo.map(line).join('\n\n');
  }

  const lastIsAssistant = v4Prompt.at(-1)?.role === 'assistant';
  if (lastIsAssistant && !transcript.endsWith('AI:')) transcript += '\n\nAI:';
  const preamble = systemParts.length ? `[System]\n${systemParts.join('\n\n')}\n\n` : '';
  return preamble + transcript;
}

// ---------------- Gemini web ----------------
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

// ---------------- Gemini share (shared conversation) ----------------

/**
 * Chat interaktif pada shared conversation Gemini via rpc q4uTj
 * (fallback: transcript tetap via ujx1Bf bila tidak ada pesan).
 * @param {object} opts
 * @param {string} opts.modelId 'gemini-share'.
 */
export function createGeminiShareWebModel({ modelId = 'gemini-share' } = {}) {
  return {
    specificationVersion: 'v4',
    provider: 'gemini-share',
    modelId,
    supportedUrls: {},
    async doGenerate(options) {
      const promptText = flattenV4Prompt(options.prompt);
      const { text } = await generateGeminiShare(promptText);
      return {
        content: [{ type: 'text', text }],
        finishReason: finish('stop'),
        usage: makeUsage(promptText, text),
        warnings: [],
      };
    },
    async doStream(options) {
      const promptText = flattenV4Prompt(options.prompt);
      const { text } = await generateGeminiShare(promptText);
      return fakeSingleChunkStream(promptText, text);
    },
  };
}

// ---------------- EaseMate web (sign WASM, kuota per-IP) ----------------

/**
 * @param {object} opts
 * @param {string} opts.modelId ID publik ('easemate').
 */
export function createEaseMateWebModel({ modelId = 'easemate' } = {}) {
  return {
    specificationVersion: 'v4',
    provider: 'easemate-web',
    modelId,
    supportedUrls: {},
    async doGenerate(options) {
      const promptText = flattenV4Prompt(options.prompt);
      let content = '';
      let reasoning = '';
      for await (const d of streamEasemate({ prompt: promptText })) {
        if (d.type === 'reasoning') reasoning += d.text;
        else content += d.text;
      }
      if (!content.trim() && !reasoning.trim()) throw new Error('easemate mengembalikan konten kosong');
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
      // part HARUS objek LanguageModelV4StreamPart, bukan string JSON
      const iterator = streamEasemate({ prompt: promptText });

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

// ---------------- Puru (HF Space OpenAI-compatible) ----------------

/**
 * Model upstream 'auto/best-free' pada Hugging Face Space OpenAI-compatible,
 * dibungkus jadi id publik 'puru'. Streaming real (SSE upstream dipompa
 * ke part LanguageModelV4) — pola sama dengan EaseMate.
 * Konfigurasi: PURUBOY_PURU_BASE_URL & PURUBOY_PURU_API_KEY (env).
 * @param {object} opts
 * @param {string} opts.modelId ID publik ('puru').
 */
export function createPuruWebModel({ modelId = 'puru' } = {}) {
  return {
    specificationVersion: 'v4',
    provider: 'puru-openai',
    modelId,
    supportedUrls: {},
    async doGenerate(options) {
      const promptText = flattenV4Prompt(options.prompt);
      let content = '';
      let reasoning = '';
      for await (const d of streamPuru({ prompt: promptText })) {
        if (d.type === 'reasoning') reasoning += d.text;
        else content += d.text;
      }
      if (!content.trim() && !reasoning.trim()) throw new Error('puru mengembalikan konten kosong');
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
      const iterator = streamPuru({ prompt: promptText });

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

// ------- Auto (rantai fallback dinamis; default Gemini -> EaseMate) -------

/**
 * Urutan DEFAULT rantai mode 'auto' dari lib/ai-models.js (AUTO_CHAIN_DEFAULT).
 * Urutan aktual bisa diubah admin lewat panel (public/admin.html tab "Auto Model"
 * -> POST /api/admin/aichain -> tabel settings DB), dibaca ulang route tiap
 * request (cache 60s). ID sah = AUTO_CHAIN_ALLOWED (model chainable).
 */

/** Rapikan rantai: buang ID tak dikenal/duplikat; kosong -> urutan default. */
export function normalizeAutoChain(chain) {
  const out = [];
  for (const id of Array.isArray(chain) ? chain : []) {
    if (AUTO_CHAIN_ALLOWED.includes(id) && !out.includes(id)) out.push(id);
  }
  return out.length ? out : [...AUTO_CHAIN_DEFAULT];
}

function buildChainCandidates(chain) {
  return normalizeAutoChain(chain).map((modelId) => {
    if (modelId === 'gemini-lite') return createGeminiWebModel({ modelId: 'gemini-lite' });
    if (modelId === 'gemini-share') return createGeminiShareWebModel({ modelId: 'gemini-share' });
    if (modelId === 'puru') return createPuruWebModel({ modelId: 'puru' });
    return createEaseMateWebModel({ modelId: 'easemate' });
  });
}

/**
 * generateText menyusuri rantai kandidat secara berurutan.
 * Aturan penerimaan SAMA untuk semua kandidat: harus ada TEKS konten
 * non-whitespace — reasoning saja TIDAK cukup, dan aman untuk kasus tools
 * karena tool call memang lahir dari teks (XML diparse di atas adapter ini).
 *
 * @returns {{candidate: object, result: object}} kandidat pertama yang diterima.
 * @throws Error ringkasan bila SEMUA kandidat gagal (route balas HTTP 500).
 */
export async function runChainGenerate(candidates, options) {
  let lastErr;
  for (let i = 0; i < candidates.length; i++) {
    const cand = candidates[i];
    const next = candidates[i + 1];
    try {
      const result = await cand.doGenerate(options);
      const text = (result.content ?? [])
        .filter((p) => p?.type === 'text')
        .map((p) => p.text ?? '')
        .join('');
      if (!text.trim()) throw new Error(`${cand.modelId} mengembalikan konten kosong`);
      return { candidate: cand, result };
    } catch (err) {
      lastErr = err;
      console.error(`[auto] ${cand.modelId} gagal ("${err?.message ?? err}")${next ? `, lanjut ke ${next.modelId}` : ', semua provider habis'}`);
    }
  }
  throw new Error(`Semua provider rantai auto gagal (${lastErr?.message ?? 'tidak ada kandidat'})`);
}

/**
 * Pompa satu stream kandidat ke controller output bersama sambil memantau konten.
 * Part 'stream-start' kandidat dibuang (sudah dikirim pemanggil) dan part
 * 'finish' DITAHAN — disimpan agar bisa diteruskan saat kandidat diterima
 * (membawa usage aslinya). Dengan menahan finish, keputusan fallback baru
 * diambil SETELAH stream kandidat selesai; bila gagal bersih, tak satu pun
 * chunk konten yang bocor ke konsumen.
 *
 * @returns {Promise<{ok:boolean, leaked:boolean, emittedError:boolean,
 *                    reason:string, finish:object|null}>}
 *   ok     = teks konten non-whitespace dimuat sampai selesai
 *   leaked = chunk konten/error sudah terlanjur diteruskan (fallback bersih tak mungkin)
 */
async function pumpCandidateStream(cand, stream, controller, hooks = {}) {
  const reader = stream.getReader();
  let text = '';
  let sawFinish = null;
  let emittedError = false;
  let committed = false;
  // Commit = chunk payload pertama akan diteruskan. Wajib memberi tahu pemanggil
  // SEBELUM enqueue agar konsumen (route SSE) sempat menandai model aktif.
  const commit = () => {
    if (committed) return;
    committed = true;
    hooks.onCommit?.(cand.modelId);
  };
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value?.type) continue;
      if (value.type === 'stream-start') continue;
      if (value.type === 'finish') { sawFinish = value; continue; }
      // CATATAN: part level ADAPTER memakai field `delta`, bukan `text`
      // (yang `text` adalah fullStream level SDK setelah dinormalisasi).
      if (value.type === 'text-delta') text += value.text ?? value.delta ?? '';
      if (value.type === 'error') {
        if (text.trim()) {
          commit();
          controller.enqueue(value);
          emittedError = true;
          return { ok: false, leaked: true, emittedError, reason: value.error?.message ?? 'upstream error', finish: sawFinish };
        }
        // Error SEBELUM konten apa pun -> gagal bersih, kandidat boleh diganti.
        return { ok: false, leaked: false, emittedError: false, reason: value.error?.message ?? 'upstream error', finish: sawFinish };
      }
      commit();
      controller.enqueue(value);
    }
  } catch (err) {
    const reason = err?.message ?? String(err);
    if (text.trim()) return { ok: false, leaked: true, emittedError, reason, finish: sawFinish };
    return { ok: false, leaked: !committed, emittedError: false, reason, finish: sawFinish };
  }
  return {
    ok: Boolean(text.trim()),
    leaked: false,
    emittedError,
    reason: text.trim() ? '' : 'selesai tanpa konten',
    finish: sawFinish,
  };
}

/**
 * Streaming menyusuri rantai kandidat di atas SATU ReadableStream bersama.
 * Kandidat gagal bersih — error apa pun ATAU stream selesai ("done") tanpa
 * tool call & tanpa konten (termasuk yang hanya berisi reasoning) SEBELUM
 * chunk konten pertama terkirim — otomatis diganti kandidat berikutnya dalam
 * SSE yang sama; klien tidak melihat retry.
 * Semua kandidat gagal -> part {type:'error'} dengan pesan jelas
 * (bukan completion kosong hening).
 *
 * @param {Array} candidates hasil buildChainCandidates()
 * @param {object} options opsi LanguageModelV4 (prompt dll.), diteruskan mentah
 * @param {object} [hooks] `onCommit(modelId)` saat chunk payload pertama akan
 *                         diteruskan; `onAccept(modelId)` saat kandidat diterima
 * @returns {ReadableStream<LanguageModelV4StreamPart>}
 */
export function runChainStream(candidates, options, hooks = {}) {
  return new ReadableStream({
    async start(controller) {
      controller.enqueue({ type: 'stream-start', warnings: [] });
      let lastReason = 'tidak ada kandidat';
      for (let i = 0; i < candidates.length; i++) {
        const cand = candidates[i];
        const next = candidates[i + 1];

        let inner;
        try {
          inner = await cand.doStream(options);
        } catch (err) {
          // Stream belum terbentuk -> belum ada yang bocor; aman lanjut.
          lastReason = err?.message ?? String(err);
          console.error(`[auto] ${cand.modelId} gagal ("${lastReason}")${next ? `, lanjut ke ${next.modelId}` : ', semua provider habis'}`);
          continue;
        }

        const outcome = await pumpCandidateStream(cand, inner.stream, controller, hooks);
        if (outcome.ok) {
          hooks.onAccept?.(cand.modelId);
          controller.enqueue(outcome.finish ?? {
            type: 'finish',
            usage: { inputTokens: { total: 0 }, outputTokens: { total: 0 } },
            finishReason: finish('stop'),
          });
          controller.close();
          return;
        }

        lastReason = outcome.reason || 'selesai tanpa konten';
        console.error(`[auto] ${cand.modelId} gagal ("${lastReason}")${next ? `, lanjut ke ${next.modelId}` : ', semua provider habis'}`);
        if (outcome.leaked) {
          // Konten sudah terlanjur terkirim lalu gagal -> fallback bersih tak
          // mungkin; pastikan konsumen menerima part error lalu berhenti.
          if (!outcome.emittedError) {
            controller.enqueue({ type: 'error', error: new Error(`[${cand.modelId}] ${lastReason}`) });
          }
          controller.close();
          return;
        }
      }
      controller.enqueue({
        type: 'error',
        error: new Error(`Semua provider rantai auto gagal (${lastReason})`),
      });
      controller.close();
    },
  });
}

/**
 * Adapter 'auto': model default endpoint. Menjawab lewat RANTAI provider yang
 * urutannya bisa diubah dari panel admin (default: Gemini Flash-Lite dulu,
 * fallback EaseMate).
 *
 * Deteksi kegagalan per kandidat:
 *   - error apa pun sebelum chunk konten pertama terkirim, ATAU
 *   - stream selesai tanpa tool call & konten kosong (reasoning-only dihitung
 *     kosong juga).
 * Jalur Gemini sendiri selalu buffer teks penuh dulu, sehingga untuk kandidat
 * pertama keputusan selalu tuntas sebelum SSE mulai; kandidat live-streaming
 * berikutnya dipantau real-time oleh runChainStream().
 * Semua kandidat gagal: non-streaming -> throw (HTTP 500 oleh route);
 * streaming -> part error pada SSE (status tetap 200 karena Response sudah dibuat).
 *
 * @param {object} opts
 * @param {object} [opts.meta] objek output; `meta.used` diisi ID model aktual
 *                             yang benar-benar menjawab.
 * @param {string[]} [opts.chain] urutan ID provider ('gemini-lite'|'easemate');
 *                                hilang/tak valid -> urutan default.
 */
export function createAutoWebModel({ meta = {}, chain } = {}) {
  const candidates = buildChainCandidates(chain);
  return {
    specificationVersion: 'v4',
    provider: 'auto-web',
    modelId: 'auto',
    supportedUrls: {},
    async doGenerate(options) {
      const { candidate, result } = await runChainGenerate(candidates, options);
      meta.used = candidate.modelId;
      return result;
    },
    async doStream(options) {
      return {
        stream: runChainStream(candidates, options, {
          // onCommit penting: kandidat live-streaming bisa mengirim payload
          // jauh sebelum keputusan akhir; nama model pada SSE harus sudah benar.
          onCommit: (modelId) => { meta.used = modelId; },
          onAccept: (modelId) => { meta.used = modelId; },
        }),
      };
    },
  };
}

/** Pilih adapter sesuai nama model OpenAI-style (lihat ALL_MODEL_IDS). */
export function createWebModel(modelId, { meta, chain } = {}) {
  if (modelId === 'gemini-lite') return createGeminiWebModel({ modelId });
  if (modelId === 'auto') return createAutoWebModel({ meta, chain });
  if (modelId === 'puru') return createPuruWebModel({ modelId });
  if (modelId === 'easemate') return createEaseMateWebModel({ modelId });
  if (modelId === 'gemini-share') return createGeminiShareWebModel({ modelId });
  throw new Error(`Model tidak dikenal: ${modelId}`);
}

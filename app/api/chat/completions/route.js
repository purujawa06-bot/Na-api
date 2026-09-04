/**
 * @title Chat Completions (OpenAI Compatible)
 * @summary Endpoint chat completions kompatibel OpenAI API untuk berbagai provider web.
 * @description Bridge OpenAI Chat Completions -> provider web (Gemini, Claude, GPT) via Vercel AI SDK.
 *              Mendukung multi-turn (system/user/assistant), streaming SSE, reasoning_content,
 *              FUNCTION CALLING (body.tools) untuk semua model — tool calls
 *              diemulasi via prompt-injection middleware (@ai-sdk-tool/parser, protokol
 *              Qwen3-Coder XML; body.tool_choice diabaikan),
 *              sehingga endpoint ini bisa dipakai sebagai backend CLI/ai agent (OpenAI-compatible).
 *              Bisa dipakai langsung dari SDK OpenAI dengan baseURL custom:
 *              OPENAI_BASE_URL=https://puruboy-api.vercel.app/api
 * @method POST
 * @path /api/chat/completions
 * @response stream
 * @param {string} [body.model] - ID model (default "auto": menyusuri rantai fallback; error ATAU stream selesai tanpa tool call & konten kosong memicu pindah provider. Urutan provider diatur dari panel admin /admin.html). Daftar lengkap: lib/ai-models.js (docs/panel admin ambil otomatis dari sana).
 * @param {array} body.messages - Array pesan format OpenAI [{role: "system"|"user"|"assistant"|"tool", content}].
 *                                 Pesan assistant boleh punya tool_calls; role "tool" membawa hasil eksekusi tool.
 * @param {boolean} [body.stream] - Gunakan streaming SSE untuk respons real-time.
 *        @choice true - Ya (Streaming)
 *        @choice false - Tidak (JSON Default)
 * @param {array} [body.tools] - Definisi fungsi format OpenAI [{type:"function", function:{name, description, parameters}}].
 *                               Diemulasi via protokol Qwen3-Coder XML (model web tidak punya native function calling).
 * @example Kembalikan jawaban langsung (non-streaming, model auto)
 * fetch('https://puruboy-api.vercel.app/api/chat/completions', {
 *     method: 'POST',
 *     headers: { 'Content-Type': 'application/json' },
 *     body: JSON.stringify({
 *         model: 'auto',
 *         messages: [{ role: 'user', content: 'Halo, apa itu Next.js?' }]
 *     })
 * }).then(res => res.json()).then(console.log);
 *
 * @example Streaming SSE
 * fetch('https://puruboy-api.vercel.app/api/chat/completions', {
 *     method: 'POST',
 *     headers: { 'Content-Type': 'application/json' },
 *     body: JSON.stringify({
 *         model: 'auto',
 *         stream: true,
 *         messages: [
 *             { role: 'system', content: 'Jawab singkat.' },
 *             { role: 'user', content: 'Jelaskan fotosintesis' }
 *         ]
 *     })
 * }).then(res => {
 *     const reader = res.body.getReader();
 *     const dec = new TextDecoder();
 *     (async () => {
 *         while (true) {
 *             const { done, value } = await reader.read();
 *             if (done) break;
 *             console.log(dec.decode(value));
 *         }
 *     })();
 * });
 *
 * @example Function calling (tools) — balasan berisi message.tool_calls
 * fetch('https://puruboy-api.vercel.app/api/chat/completions', {
 *     method: 'POST',
 *     headers: { 'Content-Type': 'application/json' },
 *     body: JSON.stringify({
 *         model: 'auto',
 *         messages: [{ role: 'user', content: 'Bagaimana cuaca di Jakarta?' }],
 *         tools: [{
 *             type: 'function',
 *             function: {
 *                 name: 'getWeather',
 *                 description: 'Cuaca sebuah kota',
 *                 parameters: { type:'object', properties:{ city:{type:'string'} }, required:['city'] }
 *             }
 *         }]
 *     })
 * }).then(res => res.json()).then(console.log);
 */
import { randomBytes } from 'node:crypto';
import { NextResponse } from 'next/server';
import { generateText, streamText, wrapLanguageModel, stepCountIs } from 'ai';
import { qwen3CoderToolMiddleware } from '@ai-sdk-tool/parser';
import { jsonSchema } from '@ai-sdk/provider-utils';
import { createDsmlSanitizerMiddleware } from '../../../../lib/dsml-sanitizer.js';
import { uiArtifactSanitizerMiddleware } from '../../../../lib/ui-artifact-sanitizer.js';
import { reportError } from '../../../../lib/errorLogger';
import { createWebModel, ALL_MODEL_IDS } from '../../../../lib/ai-provider-web.js';
import settingsService from '../../../../lib/settingsService';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

const CREATED = Math.floor(Date.now() / 1000);

function genId() {
  return `chatcmpl-${randomBytes(12).toString('hex')}`;
}

// ---------------- Konversi OpenAI -> ModelMessage ----------------

/**
 * Pesan assistant OpenAI dengan tool_calls -> parts teks + tool-call.
 * Middleware Qwen3-Coder XML mengubah keduanya jadi teks sebelum sampai adapter.
 */
function assistantToolCallParts(toolCalls = []) {
  return toolCalls.map((tc) => ({
    type: 'tool-call',
    toolCallId: tc.id ?? genId(),
    toolName: tc.function?.name ?? 'unknown_tool',
    input: safeParseJson(tc.function?.arguments),
  }));
}

/** Parse string JSON dengan fallback aman. */
function safeParseJson(str) {
  if (typeof str !== 'string') return str ?? {};
  try { return JSON.parse(str); } catch { return {}; }
}

/** Normalisasi pesan user/system: content bisa string atau array part OpenAI. */
function contentToText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    // format OpenAI vision-style: [{type:'text', text}, ...]
    return content.map((p) => (typeof p === 'string' ? p : p?.text ?? '')).join('');
  }
  return String(content ?? '');
}

/**
 * OpenAI messages -> { instructions, ModelMessage[] } (format ai v7).
 * ai v7 melarang role system di dalam `messages` — harus lewat opsi `instructions`.
 * Role "tool" dipetakan jadi tool-result message; middleware XML yang merapikan jadi teks.
 */
function splitPrompt(messages = []) {
  const instructions = [];
  const out = [];
  for (const msg of messages) {
    const { role } = msg;
    if (role === 'system' || role === 'developer') {
      instructions.push(contentToText(msg.content));
    } else if (role === 'tool') {
      out.push({
        role: 'tool',
        content: [{
          type: 'tool-result',
          toolCallId: msg.tool_call_id ?? 'unknown-id',
          toolName: msg.name ?? 'unknown_tool',
          output: { type: 'text', value: contentToText(msg.content) },
        }],
      });
    } else if (role === 'assistant') {
      const hasToolCalls = Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0;
      const text = contentToText(msg.content);
      out.push({
        role: 'assistant',
        content: [
          ...(text ? [{ type: 'text', text }] : []),
          ...(hasToolCalls ? assistantToolCallParts(msg.tool_calls) : []),
        ],
      });
    } else {
      out.push({ role: 'user', content: contentToText(msg.content) });
    }
  }
  return {
    instructions: instructions.join('\n\n') || undefined,
    messages: out,
  };
}

// ---------------- Konversi OpenAI tools -> AI SDK ----------------

/**
 * Definisi tool OpenAI -> Record<name, Tool> untuk ai v7.
 * Schema parameter dibungkus jsonSchema() supaya tanpa validasi ketat (model web bebas bentuk outputnya).
 */
function toAiTools(tools = []) {
  const map = {};
  for (const t of tools) {
    const fn = t.function ?? t; // dukung juga shorthand {name, description, parameters}
    if (!fn?.name) continue;
    map[fn.name] = {
      description: fn.description ?? '',
      inputSchema: jsonSchema(fn.parameters ?? { type: 'object', properties: {} }),
    };
  }
  return map;
}

/**
 * Susun model siap generate: adapter web, dibungkus middleware XML bila ada tools.
 * `meta` diteruskan ke adapter auto agar route tahu model aktual yang dipakai.
 * `chain` = urutan fallback mode 'auto' dari settings admin (diabaikan model lain).
 */
function buildModel(modelId, { tools, meta, chain }) {
  const base = createWebModel(modelId, { meta, chain });
  // Lapisan terdalam: buang markup UI bocoran (<ElicitationsGroup> dll.) dari
  // semua provider — dipasang tanpa syarat karena mode auto bisa jatuh ke mana pun.
  const clean = wrapLanguageModel({ model: base, middleware: uiArtifactSanitizerMiddleware });
  if (!tools || !Object.keys(tools).length) return clean;
  // Lapisan dalam: konversi bocoran format DSML DeepSeek -> Qwen3-Coder XML.
  return wrapLanguageModel({
    model: wrapLanguageModel({ model: clean, middleware: createDsmlSanitizerMiddleware({ target: 'qwen' }) }),
    middleware: qwen3CoderToolMiddleware,
  });
}

// ---------------- Pemetaan hasil -> OpenAI response ----------------

function usageFrom(result) {
  // usage di hasil generateText sudah flat (bukan nested V4): { inputTokens, outputTokens }
  const inTok = result.usage?.inputTokens ?? 0;
  const outTok = result.usage?.outputTokens ?? 0;
  return {
    prompt_tokens: inTok,
    completion_tokens: outTok,
    total_tokens: inTok + outTok,
  };
}

/** Gabungkan seluruh langkah multi-step jadi satu pesan OpenAI. */
function toOpenAiMessage(result) {
  let content = '';
  let reasoning = '';
  /** @type {Array<{id:string,type:'function',function:{name:string,arguments:string}}>} */
  const toolCalls = [];
  for (const step of result.steps ?? []) {
    for (const c of step.content ?? []) {
      if (c.type === 'text') content += c.text;
      if (c.type === 'reasoning') reasoning += c.text;
    }
    for (const tc of step.toolCalls ?? []) {
      toolCalls.push({
        id: tc.toolCallId,
        type: 'function',
        function: { name: tc.toolName, arguments: typeof tc.input === 'string' ? tc.input : JSON.stringify(tc.input ?? {}) },
      });
    }
  }
  const message = { role: 'assistant', content: content || null };
  if (reasoning) message.reasoning_content = reasoning;
  if (toolCalls.length) message.tool_calls = toolCalls;
  if (toolCalls.length && !content) message.content = null;
  return message;
}

/** finishReason AI SDK -> finish_reason OpenAI. */
function openAiFinish(reason) {
  switch (reason) {
    case 'stop': return 'stop';
    case 'length': return 'length';
    case 'tool-calls': return 'tool_calls';
    case 'content-filter': return 'content_filter';
    default: return 'stop';
  }
}

// ---------------- Handler ----------------

export async function POST(req) {
  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: { message: 'Invalid JSON body', type: 'invalid_request_error' } }, { status: 400 });
  }

  let { model = 'auto', messages } = body;
  const stream = body.stream === true || body.stream === 'true' || body.stream === 1 || body.stream === '1';

  if (!Array.isArray(messages) || !messages.length) {
    return NextResponse.json(
      { error: { message: "'messages' wajib berupa array non-kosong", type: 'invalid_request_error' } },
      { status: 400 }
    );
  }
  if (!ALL_MODEL_IDS.includes(model)) model = 'auto';

  const aiTools = toAiTools(body.tools ?? []);
  // body.tool_choice sengaja diabaikan: format & pemaksaan murni lewat
  // injeksi bawaan middleware parser (@ai-sdk-tool/parser).
  const { instructions, messages: modelMessages } = splitPrompt(messages);
  // meta.used diisi adapter auto dengan ID model aktual yang menjawab
  const meta = {};
  // Urutan fallback mode 'auto' dari settings admin (cache 60s; DB opsional ->
  // tanpa DB dipakai urutan default gemini-3.6-flash -> gemini-1.5-flash).
  const autoChain = model === 'auto' ? await settingsService.getAutoChain() : undefined;
  const lm = buildModel(model, { tools: aiTools, meta, chain: autoChain });

  // ---------- STREAMING ----------
  if (stream) {
    const encoder = new TextEncoder();
    const id = genId();
    const customStream = new TransformStream();
    const writer = customStream.writable.getWriter();
    // Nama model pada tiap chunk: untuk mode 'auto' di-update setelah adapter
    // memutuskan fallback (selalu terjadi SEBELUM part konten pertama tiba).
    let reportedModel = model;

    const sendChunk = (delta, finishReason = null) =>
      writer.write(encoder.encode(`data: ${JSON.stringify({
        id,
        object: 'chat.completion.chunk',
        created: CREATED,
        model: reportedModel,
        choices: [{ index: 0, delta, finish_reason: finishReason }],
      })}\n\n`));

    (async () => {
      let closed = false;
      const finishOnce = async (finishReason = 'stop') => {
        if (closed) return;
        await sendChunk({}, finishReason);
        await writer.write(encoder.encode('data: [DONE]\n\n'));
        closed = true;
      };
      const failChunk = async (message) => {
        if (closed) return;
        await writer.write(encoder.encode(`data: ${JSON.stringify({ error: { message, type: 'internal_error' } })}\n\n`));
        closed = true;
      };
      // Chunk role dikirim lazy (saat part pertama tiba) agar sudah membawa
      // nama model final hasil keputusan fallback mode 'auto'.
      let roleSent = false;
      const ensureRole = async () => {
        if (roleSent || closed) return;
        roleSent = true;
        if (meta.used && meta.used !== reportedModel) reportedModel = meta.used;
        await sendChunk({ role: 'assistant', content: '' });
      };

      let waitCount = 0;
      let firstPartGot = false;
      // Keep-alive: selama fallback provider masih menunggu respons, kirim
      // chunk reasoning palsu "waiting..." tiap 2s agar middleware tidak timeout
      // sambil mencoba provider satu per satu.
      const keepAlive = setInterval(() => {
        if (firstPartGot || closed) { clearInterval(keepAlive); return; }
        waitCount += 1;
        const pad = '.'.repeat(Math.min(waitCount, 6));
        sendChunk({ reasoning_content: `[menunggu respons provider ${pad}]` }).catch(() => {});
      }, 2000);

      try {
        const result = streamText({
          model: lm,
          instructions, // system prompt (ai v7 melarang system di messages)
          messages: modelMessages,
          ...(Object.keys(aiTools).length ? { tools: aiTools } : {}),
        });

        /** @type {Map<string, number>} toolCallId -> index dalam delta.tool_calls[] */
        const tcIndex = new Map();
        let lastFinish = 'stop';

        const seenPart = () => {
          firstPartGot = true;
          clearInterval(keepAlive);
        };

        for await (const part of result.fullStream) {
          switch (part.type) {
            case 'reasoning-delta':
              // fullStream level SDK memakai field `text` (bukan `delta`)
              seenPart();
              await ensureRole();
              await sendChunk({ reasoning_content: part.text });
              break;
            case 'text-delta':
              seenPart();
              await ensureRole();
              await sendChunk({ content: part.text });
              break;
            case 'tool-input-start': {
              seenPart();
              await ensureRole();
              // buka blok arguments di chunk baru
              const idx = tcIndex.size;
              tcIndex.set(part.id, idx);
              await sendChunk({ tool_calls: [{ index: idx, id: part.id, type: 'function', function: { name: part.toolName, arguments: '' } }] });
              break;
            }
            case 'tool-input-delta': {
              const idx = tcIndex.get(part.id) ?? 0;
              await sendChunk({ tool_calls: [{ index: idx, function: { arguments: part.delta } }] });
              break;
            }
            case 'finish':
              lastFinish = openAiFinish(typeof part.finishReason === 'string' ? part.finishReason : part.finishReason?.unified);
              break;
            case 'error':
              throw part.error;
            default:
              break;
          }
        }

        await ensureRole();
        await finishOnce(lastFinish);
      } catch (err) {
        reportError(err, { endpoint: '/api/chat/completions', stream: true, model }).catch(() => {});
        await failChunk(err.message);
        await finishOnce('stop');
      } finally {
        clearInterval(keepAlive);
        try { await writer.close(); } catch { /* sudah tertutup */ }
      }
    })();

    return new Response(customStream.readable, {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  }

  // ---------- NON-STREAMING ----------
  try {
    const result = await generateText({
      model: lm,
      instructions, // system prompt (ai v7 melarang system di messages)
      messages: modelMessages,
      ...(Object.keys(aiTools).length ? {
        tools: aiTools,
        stopWhen: stepCountIs(1), // passthrough: balas tool_calls ke agent, JANGAN auto-eksekusi
      } : {}),
    });

    const message = toOpenAiMessage(result);
    const finishReason = message.tool_calls?.length ? 'tool_calls' : openAiFinish(result.finishReason?.unified);

    return NextResponse.json({
      id: genId(),
      object: 'chat.completion',
      created: CREATED,
      model: meta.used || model, // mode auto: laporkan model aktual yang menjawab
      choices: [{ index: 0, message, finish_reason: finishReason }],
      usage: usageFrom(result),
    });
  } catch (error) {
    reportError(error, { endpoint: '/api/chat/completions', method: 'POST', model }).catch(() => {});
    return NextResponse.json(
      { error: { message: error.message, type: 'internal_error' } },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json({
    endpoint: '/api/chat/completions',
    compatible: 'OpenAI Chat Completions API',
    models: ALL_MODEL_IDS,
    features: ['multi-turn', 'streaming-sse', 'reasoning_content', 'function-calling (qwen3-coder xml emulation)'],
    usage: {
      method: 'POST',
      body: {
        model: `${ALL_MODEL_IDS.join(' | ')} (default auto: rantai fallback dinamis dari panel admin)`,
        messages: '[{role: system|user|assistant|tool, content}]',
        stream: 'boolean (opsional)',
        tools: '[{type:"function", function:{name, description, parameters}}] (opsional)',
        tool_choice: 'diabaikan (kompatibilitas OpenAI saja)',
      },
      curl: `curl -X POST http://localhost:8080/api/chat/completions -H "Content-Type: application/json" -d '{"model":"auto","messages":[{"role":"user","content":"halo"}]}'`,
    },
    note: 'Function calling diemulasi via prompt injection (protokol Qwen3-Coder XML) karena model web tidak punya native tools.',
  });
}

/**
 * @title Chat Completions (OpenAI Compatible)
 * @summary Endpoint chat completions kompatibel OpenAI API untuk berbagai provider web.
 * @description Bridge OpenAI Chat Completions -> provider web (DeepSeek & Gemini) via Vercel AI SDK.
 *              Mendukung multi-turn (system/user/assistant), streaming SSE, reasoning_content,
 *              FUNCTION CALLING (body.tools + body.tool_choice) untuk semua model — tool calls
 *              diemulasi via prompt-injection middleware (@ai-sdk-tool/parser, protokol Hermes),
 *              sehingga endpoint ini bisa dipakai sebagai backend CLI/ai agent (OpenAI-compatible).
 *              Bisa dipakai langsung dari SDK OpenAI dengan baseURL custom:
 *              OPENAI_BASE_URL=https://puruboy-api.vercel.app/api
 * @method POST
 * @path /api/chat/completions
 * @response stream
 * @param {string} [body.model] - ID model (default deepseek-chat).
 * @choice deepseek-chat - DeepSeek V3 cepat (tanpa thinking)
 * @choice deepseek-reasoner - DeepSeek R1 dengan thinking/reasoning
 * @choice deepseek-v3 - alias deepseek-chat
 * @choice deepseek-r1 - alias deepseek-reasoner
 * @choice gemini-flash - Gemini 3.6 Flash (serbaguna)
 * @choice gemini-flash-lite - Gemini 3.5 Flash-Lite (tercepat)
 * @param {array} body.messages - Array pesan format OpenAI [{role: "system"|"user"|"assistant"|"tool", content}].
 *                                 Pesan assistant boleh punya tool_calls; role "tool" membawa hasil eksekusi tool.
 * @param {boolean} [body.stream] - true untuk streaming SSE (default false).
 * @param {array} [body.tools] - Definisi fungsi format OpenAI [{type:"function", function:{name, description, parameters}}].
 *                               Diemulasi via protokol Hermes (model web tidak punya native function calling).
 * @param {string|object} [body.tool_choice] - "auto" | "none" | "required" | {type:"function", function:{name}}.
 * @example Kembalikan jawaban langsung (non-streaming)
 * fetch('https://puruboy-api.vercel.app/api/chat/completions', {
 *     method: 'POST',
 *     headers: { 'Content-Type': 'application/json' },
 *     body: JSON.stringify({
 *         model: 'deepseek-chat',
 *         messages: [{ role: 'user', content: 'Halo, apa itu Next.js?' }]
 *     })
 * }).then(res => res.json()).then(console.log);
 *
 * @example Streaming SSE + model reasoning
 * fetch('https://puruboy-api.vercel.app/api/chat/completions', {
 *     method: 'POST',
 *     headers: { 'Content-Type': 'application/json' },
 *     body: JSON.stringify({
 *         model: 'deepseek-reasoner',
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
 *         model: 'gemini-flash',
 *         messages: [{ role: 'user', content: 'Bagaimana cuaca di Jakarta?' }],
 *         tool_choice: 'auto',
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
import { hermesToolMiddleware } from '@ai-sdk-tool/parser';
import { jsonSchema } from '@ai-sdk/provider-utils';
import { reportError } from '../../../../lib/errorLogger';
import { createWebModel, ALL_MODEL_IDS } from '../../../../lib/ai-provider-web.js';

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
 * Middleware Hermes mengubah keduanya jadi teks sebelum sampai adapter.
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
 * Role "tool" dipetakan jadi tool-result message; middleware Hermes yang merapikan jadi teks.
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
 * OpenAI tool_choice -> toolChoice AI SDK.
 * Hanya 'none' yang diteruskan ke SDK ('auto' = undefined).
 * 'required' & {type:'function'} TIDAK diteruskan: parser Hermes mengharapkan
 * output JSON murni sesuai responseFormat pada mode itu, sedangkan adapter web
 * mengabaikan responseFormat (model web tetap memakai protokol <tool_call>) —
 * hasilnya tool call invalid "unknown". Keduanya diterjemahkan menjadi instruksi
 * teks tambahan di instructions (lihat POST) lewat jalur 'auto' yang terbukti.
 */
function toToolChoice(choice) {
  if (!choice || choice === 'auto') return undefined;
  if (choice === 'none') return 'none';
  return undefined;
}

/** Instruksi teks pengganti tool_choice 'required' / named-tool (prompt injection). */
function forcedChoiceInstructions(choice, hasTools) {
  if (!hasTools) return [];
  const notes = [];
  if (choice === 'required') {
    notes.push('You MUST call one of the available functions in this turn. Do not answer with plain text.');
  } else if (typeof choice === 'object' && choice.type === 'function' && choice.function?.name) {
    notes.push(`You MUST call the function "${choice.function.name}" in this turn. Do not answer with plain text.`);
  }
  return notes;
}

/**
 * Susun model siap generate: adapter web, dibungkus middleware Hermes bila ada tools.
 */
function buildModel(modelId, { searchEnabled, tools }) {
  const base = createWebModel(modelId, { searchEnabled });
  return tools && Object.keys(tools).length
    ? wrapLanguageModel({ model: base, middleware: hermesToolMiddleware })
    : base;
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

  let { model = 'deepseek-chat', messages } = body;
  const stream = body.stream === true || body.stream === 'true' || body.stream === 1 || body.stream === '1';

  if (!Array.isArray(messages) || !messages.length) {
    return NextResponse.json(
      { error: { message: "'messages' wajib berupa array non-kosong", type: 'invalid_request_error' } },
      { status: 400 }
    );
  }
  if (!ALL_MODEL_IDS.includes(model)) model = 'deepseek-chat';

  const searchEnabled = body.search_enabled === true;
  const aiTools = toAiTools(body.tools ?? []);
  const toolChoice = toToolChoice(body.tool_choice);
  const { instructions: baseInstructions, messages: modelMessages } = splitPrompt(messages);
  // 'required' & named-tool dijemahkan jadi instruksi teks (bukan toolChoice SDK)
  const forceNotes = forcedChoiceInstructions(body.tool_choice, Object.keys(aiTools).length > 0);
  const instructions = [baseInstructions, ...forceNotes].filter(Boolean).join('\n\n') || undefined;
  const lm = buildModel(model, { searchEnabled, tools: aiTools });

  // ---------- STREAMING ----------
  if (stream) {
    const encoder = new TextEncoder();
    const id = genId();
    const customStream = new TransformStream();
    const writer = customStream.writable.getWriter();

    const sendChunk = (delta, finishReason = null) =>
      writer.write(encoder.encode(`data: ${JSON.stringify({
        id,
        object: 'chat.completion.chunk',
        created: CREATED,
        model,
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

      try {
        const result = streamText({
          model: lm,
          instructions, // system prompt (ai v7 melarang system di messages)
          messages: modelMessages,
          ...(Object.keys(aiTools).length ? {
            tools: aiTools,
            ...(toolChoice ? { toolChoice } : {}),
            stopWhen: stepCountIs(1), // mode passthrough: agent eksekusi tool-nya sendiri
          } : {}),
        });

        await sendChunk({ role: 'assistant', content: '' });

        /** @type {Map<string, number>} toolCallId -> index dalam delta.tool_calls[] */
        const tcIndex = new Map();
        let lastFinish = 'stop';

        for await (const part of result.fullStream) {
          switch (part.type) {
            case 'reasoning-delta':
              // fullStream level SDK memakai field `text` (bukan `delta`)
              await sendChunk({ reasoning_content: part.text });
              break;
            case 'text-delta':
              await sendChunk({ content: part.text });
              break;
            case 'tool-input-start': {
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

        await finishOnce(lastFinish);
      } catch (err) {
        reportError(err, { endpoint: '/api/chat/completions', stream: true, model }).catch(() => {});
        await failChunk(err.message);
        await finishOnce('stop');
      } finally {
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
        ...(toolChoice ? { toolChoice } : {}),
        stopWhen: stepCountIs(1), // passthrough: balas tool_calls ke agent, JANGAN auto-eksekusi
      } : {}),
    });

    const message = toOpenAiMessage(result);
    const finishReason = message.tool_calls?.length ? 'tool_calls' : openAiFinish(result.finishReason?.unified);

    return NextResponse.json({
      id: genId(),
      object: 'chat.completion',
      created: CREATED,
      model,
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
    features: ['multi-turn', 'streaming-sse', 'reasoning_content', 'function-calling (hermes emulation)'],
    usage: {
      method: 'POST',
      body: {
        model: 'deepseek-chat | deepseek-reasoner | gemini-flash | gemini-flash-lite (default deepseek-chat)',
        messages: '[{role: system|user|assistant|tool, content}]',
        stream: 'boolean (opsional)',
        tools: '[{type:"function", function:{name, description, parameters}}] (opsional)',
        tool_choice: '"auto" | "none" | "required" | {type:"function",function:{name}} (opsional)',
      },
      curl: `curl -X POST http://localhost:8080/api/chat/completions -H "Content-Type: application/json" -d '{"model":"deepseek-reasoner","messages":[{"role":"user","content":"halo"}]}'`,
    },
    note: 'Function calling diemulasi via prompt injection (Hermes protocol) karena model web tidak punya native tools.',
  });
}

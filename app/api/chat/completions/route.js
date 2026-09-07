/**
 * @title Chat Completions (OpenAI Compatible)
 * @summary Endpoint chat completions kompatibel OpenAI API untuk berbagai provider web.
 * @description Bridge OpenAI Chat Completions -> provider web (Gemini, Claude, GPT) via Vercel AI SDK.
 *              Mendukung multi-turn (system/user/assistant), streaming SSE, reasoning_content,
 *              FUNCTION CALLING (body.tools) untuk semua model — tool calls
 *              diemulasi via Hermes protocol (JSON dalam XML tags, via @ai-sdk-tool/parser;
 *              body.tool_choice diabaikan),
 *              sehingga endpoint ini bisa dipakai sebagai backend CLI/ai agent (OpenAI-compatible).
 *              Cocok untuk tugas-tugas sederhana (pencarian, fetch data, cuaca, translate, dll).
 *              Bukan untuk tugas coding kompleks.
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
 *                               Diemulasi via Hermes protocol (prompt-injection, JSON dalam XML tags).
 *                               Cocok untuk tugas sederhana (pencarian, fetch, cuaca, translate, dll).
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
import { generateText, streamText, stepCountIs } from 'ai';
import { reportError } from '../../../../lib/errorLogger';
import { createWebModel, ALL_MODEL_IDS } from '../../../../lib/ai-provider-web.js';
import settingsService from '../../../../lib/settingsService';
import { splitPrompt, toAiTools, buildModel, toOpenAiMessage } from '../../../../lib/agent-step.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

const CREATED = Math.floor(Date.now() / 1000);

function genId() {
  return `chatcmpl-${randomBytes(12).toString('hex')}`;
}

// ---------------- Konversi OpenAI -> ModelMessage ----------------

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
  // injeksi bawaan middleware parser (@ai-sdk-tool/parser, Hermes protocol).
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
        /** Set toolCallId yang sudah selesai (tool-input-end) — tolak delta/start berikutnya */
        const tcClosed = new Set();
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
              // Guard: kalau id sudah pernah dibuka ATAU sudah ditutup, jangan emit lagi
              if (tcIndex.has(part.id) || tcClosed.has(part.id)) break;
              // buka blok arguments di chunk baru
              const idx = tcIndex.size;
              tcIndex.set(part.id, idx);
              await sendChunk({ tool_calls: [{ index: idx, id: part.id, type: 'function', function: { name: part.toolName, arguments: '' } }] });
              break;
            }
            case 'tool-input-delta': {
              const idx = tcIndex.get(part.id);
              // Tolak delta untuk id yang belum dibuka atau sudah ditutup
              if (idx === undefined || tcClosed.has(part.id)) break;
              await sendChunk({ tool_calls: [{ index: idx, function: { arguments: part.delta } }] });
              break;
            }
            case 'tool-input-end':
              // Tandai selesai supaya delta/start lanjutan untuk id ini diabaikan
              if (tcIndex.has(part.id)) tcClosed.add(part.id);
              break;
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
    features: ['multi-turn', 'streaming-sse', 'reasoning_content', 'function-calling (hermes protocol — cocok untuk tugas sederhana)'],
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
    note: 'Function calling diemulasi via prompt injection (Hermes protocol — JSON dalam XML tags). Cocok untuk tugas sederhana seperti pencarian, fetch, cuaca, translate. Bukan untuk coding kompleks.',
  });
}
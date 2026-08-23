/**
 * @title Chat Completions (OpenAI Compatible)
 * @summary Endpoint chat completions kompatibel OpenAI API untuk berbagai provider web.
 * @description Bridge OpenAI Chat Completions -> provider web (DeepSeek & Gemini) tanpa SDK resmi.
 *              Mendukung multi-turn (system/user/assistant), streaming SSE, dan reasoning_content
 *              untuk model reasoning. Bisa dipakai langsung dari SDK OpenAI dengan baseURL custom.
 * @method POST
 * @path /api/chat/completions
 * @response stream
 * @param {string} [body.model] - ID model (default deepseek-chat).
 * @choice deepseek-chat - DeepSeek V3 cepat (tanpa thinking)
 * @choice deepseek-reasoner - DeepSeek R1 dengan thinking/reasoning
 * @choice gemini-flash - Gemini 3.6 Flash (serbaguna)
 * @choice gemini-flash-lite - Gemini 3.5 Flash-Lite (tercepat)
 * @param {array} body.messages - Array pesan format OpenAI [{role: "system"|"user"|"assistant", content: string}].
 * @param {boolean} [body.stream] - true untuk streaming SSE (default false).
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
 * @example Gemini via web (butuh Brave CDP + login Google)
 * fetch('https://puruboy-api.vercel.app/api/chat/completions', {
 *     method: 'POST',
 *     headers: { 'Content-Type': 'application/json' },
 *     body: JSON.stringify({
 *         model: 'gemini-flash',
 *         stream: true,
 *         messages: [{ role: 'user', content: 'Siapa penemu lampu pijar?' }]
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
 */
import { randomBytes } from 'node:crypto';
import { NextResponse } from 'next/server';
import { HumanMessage, AIMessage, SystemMessage } from '@langchain/core/messages';
import { reportError } from '../../../../lib/errorLogger';
import { ChatDeepSeekWeb, MODEL_CONFIG, flattenToPrompt } from '../../../../lib/chat-deepseek-web';
import { generateGemini, MODELS as GEMINI_MODELS } from '../../../../lib/gemini-web.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

const CREATED = Math.floor(Date.now() / 1000);

function genId() {
  return `chatcmpl-${randomBytes(12).toString('hex')}`;
}

/** OpenAI messages -> LangChain BaseMessage[] */
function toLangChainMessages(messages = []) {
  return messages.map(({ role, content }) => {
    if (role === 'system' || role === 'developer') return new SystemMessage(content);
    if (role === 'assistant') return new AIMessage(content);
    return new HumanMessage(content); // user & tool fallback
  });
}

function estimateTokens(text) {
  return Math.max(1, Math.ceil((text || '').length / 4));
}

export async function POST(req) {
  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: { message: 'Invalid JSON body', type: 'invalid_request_error' } }, { status: 400 });
  }

  let { model = 'deepseek-chat', messages, stream = false } = body;

  if (!Array.isArray(messages) || !messages.length) {
    return NextResponse.json(
      { error: { message: "'messages' wajib berupa array non-kosong", type: 'invalid_request_error' } },
      { status: 400 }
    );
  }
  if (!MODEL_CONFIG[model] && !GEMINI_MODELS[model]) model = 'deepseek-chat';

  // ---------- GEMINI (via CDP Brave) ----------
  if (GEMINI_MODELS[model]) {
    const prompt = messages.map((m) => `${m.role}: ${m.content}`).join('\n');
    const modelCode = GEMINI_MODELS[model].code;

    // streaming: ambil teks penuh lalu stream per potongan
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
        try {
          await sendChunk({ role: 'assistant', content: '' });
          const { text } = await generateGemini({ prompt, modelCode });
          // stream teks per ~4 karakter agar terasa streaming
          for (let i = 0; i < text.length; i += 4) {
            const piece = text.slice(i, i + 4);
            await sendChunk({ content: piece });
            await new Promise((r) => setTimeout(r, 8));
          }
          await sendChunk({}, 'stop');
          await writer.write(encoder.encode('data: [DONE]\n\n'));
        } catch (err) {
          reportError(err, { endpoint: '/api/chat/completions', stream: true, model }).catch(() => {});
          await writer.write(encoder.encode(`data: ${JSON.stringify({ error: { message: err.message, type: 'internal_error' } })}\n\n`));
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

    // non-streaming
    try {
      const { text } = await generateGemini({ prompt, modelCode });
      const usage = {
        prompt_tokens: estimateTokens(prompt),
        completion_tokens: estimateTokens(text),
        total_tokens: estimateTokens(prompt) + estimateTokens(text),
      };
      return NextResponse.json({
        id: genId(),
        object: 'chat.completion',
        created: CREATED,
        model,
        choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }],
        usage,
      });
    } catch (error) {
      reportError(error, { endpoint: '/api/chat/completions', model }).catch(() => {});
      return NextResponse.json({ error: { message: error.message, type: 'internal_error' } }, { status: 500 });
    }
  }

  try {
    const lcMessages = toLangChainMessages(messages);
    const llm = new ChatDeepSeekWeb({
      model,
      searchEnabled: body.search_enabled === true,
    });

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
        try {
          await sendChunk({ role: 'assistant', content: '' });
          let lastContent = '';
          for await (const chunk of await llm.stream(lcMessages)) {
            const kw = chunk.additional_kwargs || {};
            if (kw.reasoning_content) await sendChunk({ reasoning_content: kw.reasoning_content });
            if (chunk.content) {
              await sendChunk({ content: chunk.content });
              lastContent += chunk.content;
            }
          }
          await sendChunk({}, 'stop');
          await writer.write(encoder.encode('data: [DONE]\n\n'));
        } catch (err) {
          reportError(err, { endpoint: '/api/chat/completions', stream: true }).catch(() => {});
          await writer.write(encoder.encode(`data: ${JSON.stringify({ error: { message: err.message, type: 'internal_error' } })}\n\n`));
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
    const result = await llm.invoke(lcMessages);
    const content = typeof result.content === 'string' ? result.content : String(result.content);
    const reasoning = result.additional_kwargs?.reasoning_content || null;

    const promptText = flattenToPrompt(lcMessages);

    return NextResponse.json({
      id: genId(),
      object: 'chat.completion',
      created: CREATED,
      model,
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content,
          ...(reasoning ? { reasoning_content: reasoning } : {}),
        },
        finish_reason: 'stop',
      }],
      usage: {
        prompt_tokens: estimateTokens(promptText),
        completion_tokens: estimateTokens(content),
        total_tokens: estimateTokens(promptText) + estimateTokens(content),
      },
    });
  } catch (error) {
    reportError(error, { endpoint: '/api/chat/completions', method: 'POST' }).catch(() => {});
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
    models: [...Object.keys(MODEL_CONFIG), ...Object.keys(GEMINI_MODELS)],
    usage: {
      method: 'POST',
      body: {
        model: 'deepseek-chat | deepseek-reasoner (default deepseek-chat)',
        messages: '[{role: system|user|assistant, content}]',
        stream: 'boolean (opsional)',
      },
      curl: `curl -X POST http://localhost:8080/api/chat/completions -H "Content-Type: application/json" -d '{"model":"deepseek-reasoner","messages":[{"role":"user","content":"halo"}]}'`,
    },
    note: 'Butuh Brave berjalan dengan CDP port 9222 dan login chat.deepseek.com',
  });
}

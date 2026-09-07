/**
 * Satu langkah agent (generateText + tools) — dipakai bersama oleh
 * /api/chat/completions (mode non-streaming) dan /api/puru-ai (agentic loop).
 *
 * Ditempatkan di lib agar tidak ada route yang meng-import route lain
 * (pola yang bisa membuat Next.js route analyzer error).
 */
import { generateText, wrapLanguageModel, stepCountIs } from 'ai';
import { hermesToolMiddleware } from '@ai-sdk-tool/parser';
import { jsonSchema } from '@ai-sdk/provider-utils';
import { createWebModel } from './ai-provider-web.js';
import settingsService from './settingsService';

/** Parse string JSON dengan fallback aman. */
function safeParseJson(str) {
  if (typeof str !== 'string') return str ?? {};
  try { return JSON.parse(str); } catch { return {}; }
}

/** Normalisasi pesan user/system: content bisa string atau array part OpenAI. */
function contentToText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((p) => (typeof p === 'string' ? p : p?.text ?? '')).join('');
  }
  return String(content ?? '');
}

/** Pesan assistant OpenAI dengan tool_calls -> parts teks + tool-call. */
function assistantToolCallParts(toolCalls = []) {
  return toolCalls.map((tc) => ({
    type: 'tool-call',
    toolCallId: tc.id ?? `tool-${Math.random().toString(36).slice(2)}`,
    toolName: tc.function?.name ?? 'unknown_tool',
    input: safeParseJson(tc.function?.arguments),
  }));
}

/**
 * OpenAI messages -> { instructions, ModelMessage[] } (format ai v7).
 * ai v7 melarang role system di dalam `messages` — harus lewat opsi `instructions`.
 */
export function splitPrompt(messages = []) {
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

/**
 * Definisi tool OpenAI -> Record<name, Tool> untuk ai v7.
 * Schema parameter dibungkus jsonSchema() supaya tanpa validasi ketat.
 */
export function toAiTools(tools = []) {
  const map = {};
  for (const t of tools) {
    const fn = t.function ?? t;
    if (!fn?.name) continue;
    map[fn.name] = {
      description: fn.description ?? '',
      inputSchema: jsonSchema(fn.parameters ?? { type: 'object', properties: {} }),
    };
  }
  return map;
}

/** Susun model siap generate: adapter web + middleware sanitizer + tools Hermes JSON. */
export function buildModel(modelId, { tools, meta, chain }) {
  const base = createWebModel(modelId, { meta, chain });
  if (!tools || !Object.keys(tools).length) return base;
  return wrapLanguageModel({
    model: base,
    middleware: hermesToolMiddleware,
  });
}

/** Gabungkan seluruh langkah multi-step jadi satu pesan OpenAI. */
export function toOpenAiMessage(result) {
  let content = '';
  let reasoning = '';
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

/**
 * Jalankan satu langkah agent (generateText + tools), passthrough:
 * balas tool_calls ke pemanggil, JANGAN auto-eksekusi.
 * @param {object} opts
 * @param {string} opts.model - ID model ('auto' dsb.)
 * @param {Array} opts.messages - pesan OpenAI (system/user/assistant/tool)
 * @param {Array} opts.tools - definisi tools OpenAI
 * @param {string[]} [opts.chain] - urutan rantai auto (opsional)
 * @returns {Promise<{message:object, model:string}>}
 */
export async function runAgenticStep({ model = 'auto', messages, tools, chain } = {}) {
  const aiTools = toAiTools(tools ?? []);
  const { instructions, messages: modelMessages } = splitPrompt(messages);
  const meta = {};
  const autoChain = model === 'auto' ? chain || (await settingsService.getAutoChain()) : undefined;
  const lm = buildModel(model, { tools: aiTools, meta, chain: autoChain });

  const result = await generateText({
    model: lm,
    instructions,
    messages: modelMessages,
    ...(Object.keys(aiTools).length ? {
      tools: aiTools,
      stopWhen: stepCountIs(1),
    } : {}),
  });

  return {
    message: toOpenAiMessage(result),
    model: meta.used || model,
  };
}
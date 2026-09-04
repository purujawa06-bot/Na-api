/**
 * @title Build Prompt (Debug / Transparency)
 * @summary Endpoint uji untuk mencetak prompt mentah yang akan dikirim ke provider web.
 * @description Menjalankan pipeline pembentukan prompt (splitPrompt -> flattenV4Prompt,
 *              termasuk tag <conversation_history>/<latest_user_message>) DAN injeksi
 *              tool system prompt dari middleware morphXml (@ai-sdk-tool/parser).
 *              Tidak memanggil provider. Lihat BUILD_PROMPT.md di direktori yang sama.
 * @method GET
 * @path /api/chat/completions/build-prompt
 * @param {string} query.messages - WAJIB. JSON array pesan format OpenAI (sama seperti body.messages).
 *   Setiap pesan punya `role` dan `content`. Role yang didukung:
 *   - `"system"` / `"developer"` → dijadikan instruksi system
 *   - `"user"` → pesan dari user
 *   - `"assistant"` → balasan model, boleh punya `tool_calls` (array)
 *   - `"tool"` → hasil eksekusi tool, wajib punya `tool_call_id` dan `name`
 * @param {string} [query.tools] - OPSIONAL. JSON array definisi tool format OpenAI.
 *   Format: `[{type:"function", function:{name, description, parameters}}]`
 *   Akan diinjeksi sebagai tool system prompt (protokol morphXml).
 * @response {string} 200 text/plain — prompt mentah persis seperti yang dikirim ke provider.
 * @header {string} X-Tools-Count - Jumlah tool yang diinjeksi.
 * @header {string} X-Message-Count - Jumlah model messages (user/assistant/tool).
 *
 * @example User biasa (tanpa tools)
 * fetch('https://puruboy-api.vercel.app/api/chat/completions/build-prompt?messages=%5B%7B%22role%22%3A%22user%22%2C%22content%22%3A%22Halo%22%7D%5D')
 *     .then(res => res.text())
 *     .then(console.log);
 *
 * @example Multi-turn dengan system
 * fetch('https://puruboy-api.vercel.app/api/chat/completions/build-prompt?messages=%5B%7B%22role%22%3A%22system%22%2C%22content%22%3A%22Jawab%20singkat.%22%7D%2C%7B%22role%22%3A%22user%22%2C%22content%22%3A%22Halo%22%7D%2C%7B%22role%22%3A%22assistant%22%2C%22content%22%3A%22Hai!%22%7D%2C%7B%22role%22%3A%22user%22%2C%22content%22%3A%22Siapa%20presiden%3F%22%7D%5D')
 *     .then(res => res.text())
 *     .then(console.log);
 *
 * @example Dengan tools (function calling)
 * fetch('https://puruboy-api.vercel.app/api/chat/completions/build-prompt?messages=%5B%7B%22role%22%3A%22user%22%2C%22content%22%3A%22Cuaca%20Jakarta%3F%22%7D%5D&tools=%5B%7B%22type%22%3A%22function%22%2C%22function%22%3A%7B%22name%22%3A%22getWeather%22%2C%22description%22%3A%22Cuaca%20kota%22%2C%22parameters%22%3A%7B%22type%22%3A%22object%22%2C%22properties%22%3A%7B%22city%22%3A%7B%22type%22%3A%22string%22%7D%7D%2C%22required%22%3A%5B%22city%22%5D%7D%7D%7D%5D')
 *     .then(res => res.text())
 *     .then(console.log);
 *
 * @example Multi-turn dengan tool_calls dan tool result
 * fetch('https://puruboy-api.vercel.app/api/chat/completions/build-prompt?messages=%5B%7B%22role%22%3A%22user%22%2C%22content%22%3A%22Cuaca%20Jakarta%3F%22%7D%2C%7B%22role%22%3A%22assistant%22%2C%22content%22%3Anull%2C%22tool_calls%22%3A%5B%7B%22id%22%3A%22call_1%22%2C%22type%22%3A%22function%22%2C%22function%22%3A%7B%22name%22%3A%22getWeather%22%2C%22arguments%22%3A%22%7B%5C%22city%5C%22%3A%5C%22Jakarta%5C%22%7D%22%7D%7D%5D%7D%2C%7B%22role%22%3A%22tool%22%2C%22tool_call_id%22%3A%22call_1%22%2C%22name%22%3A%22getWeather%22%2C%22content%22%3A%22%7B%5C%22city%5C%22%3A%5C%22Jakarta%5C%22%2C%5C%22temp%5C%22%3A32%2C%5C%22condition%5C%22%3A%5C%22sunny%5C%22%7D%22%7D%2C%7B%22role%22%3A%22user%22%2C%22content%22%3A%22Besok%20hujan%20tidak%3F%22%7D%5D&tools=%5B%7B%22type%22%3A%22function%22%2C%22function%22%3A%7B%22name%22%3A%22getWeather%22%2C%22description%22%3A%22Cuaca%20kota%22%2C%22parameters%22%3A%7B%22type%22%3A%22object%22%2C%22properties%22%3A%7B%22city%22%3A%7B%22type%22%3A%22string%22%7D%7D%2C%22required%22%3A%5B%22city%22%5D%7D%7D%7D%5D')
 *     .then(res => res.text())
 *     .then(console.log);
 */
import { NextResponse } from 'next/server';
import { morphXmlSystemPromptTemplate } from '@ai-sdk-tool/parser';
import { flattenV4Prompt } from '../../../../../lib/ai-provider-web.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function contentToText(content) {
  if (Array.isArray(content)) {
    return content.map((p) => (typeof p === 'string' ? p : p?.text ?? '')).join('');
  }
  return String(content ?? '');
}

/** Konversi tools format OpenAI -> format morphXml untuk morphXmlSystemPromptTemplate. */
function toMorphTools(tools = []) {
  const out = [];
  for (const t of tools) {
    const fn = t.function ?? t;
    if (!fn?.name) continue;
    out.push({
      name: fn.name,
      description: fn.description ?? '',
      inputSchema: fn.parameters ?? { type: 'object', properties: {} },
    });
  }
  return out;
}

/** Replikasi setia splitPrompt() dari route utama (sanitari redundansi demi kejelasan debug). */
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
          ...(hasToolCalls ? msg.tool_calls.map((tc) => {
            let input = {};
            try { input = JSON.parse(tc.function?.arguments ?? '{}'); } catch { input = {}; }
            return {
              type: 'tool-call',
              toolCallId: tc.id ?? 'unknown-id',
              toolName: tc.function?.name ?? 'unknown_tool',
              input,
            };
          }) : []),
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

export async function GET(req) {
  const url = new URL(req.url);
  const raw = url.searchParams.get('messages');
  if (!raw) {
    return NextResponse.json(
      { error: 'Gunakan ?messages=<JSON array format OpenAI> (sama seperti body.messages)' },
      { status: 400 }
    );
  }
  let messages;
  try { messages = JSON.parse(raw); } catch {
    return NextResponse.json({ error: 'messages bukan JSON valid' }, { status: 400 });
  }
  if (!Array.isArray(messages)) {
    return NextResponse.json({ error: 'messages harus berupa array' }, { status: 400 });
  }

  // Parse tools (opsional) — format sama seperti body.tools di POST
  let rawTools = [];
  const toolsRaw = url.searchParams.get('tools');
  if (toolsRaw) {
    try { rawTools = JSON.parse(toolsRaw); } catch {
      return NextResponse.json({ error: 'tools bukan JSON valid' }, { status: 400 });
    }
    if (!Array.isArray(rawTools)) {
      return NextResponse.json({ error: 'tools harus berupa array' }, { status: 400 });
    }
  }

  const { instructions, messages: modelMessages } = splitPrompt(messages);

  // Injeksi tool system prompt — persis seperti morphXmlToolMiddleware
  let toolSystemPrompt = '';
  const morphTools = toMorphTools(rawTools);
  if (morphTools.length) {
    toolSystemPrompt = morphXmlSystemPromptTemplate(morphTools);
  }

  // Gabung: [tool system prompt] + [instructions] + [model messages]
  const prompt = [
    ...(toolSystemPrompt ? [toolSystemPrompt] : []),
    ...(instructions ? [{ role: 'system', content: instructions }] : []),
    ...modelMessages,
  ];
  const built = flattenV4Prompt(prompt);

  return new Response(built, {
    status: 200,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'X-Tools-Count': String(morphTools.length),
      'X-Message-Count': String(modelMessages.length),
    },
  });
}

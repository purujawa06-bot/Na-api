/**
 * @title Build Prompt (Debug / Transparency)
 * @summary Endpoint uji untuk mencetak prompt mentah yang akan dikirim ke provider web.
 * @description Menjalankan pipeline pembentukan prompt (splitPrompt -> flattenV4Prompt,
 *              termasuk tag <conversation_history>/<latest_user_message>) dan
 *              menampilkan hasilnya agar client tahu persis bagaimana prompt dibangun.
 *              Tidak memanggil provider. Lihat BUILD_PROMPT.md di direktori yang sama.
 * @method GET
 * @path /api/chat/completions/build-prompt
 * @param {string} messages - WAJIB. JSON array pesan format OpenAI (sama seperti body.messages).
 * @example
 * /api/chat/completions/build-prompt?messages=[{"role":"user","content":"halo"},{"role":"assistant","content":"hai"},{"role":"user","content":"siapa presiden?"}]
 * @response json
 */
import { NextResponse } from 'next/server';
import { flattenV4Prompt } from '../../../../../lib/ai-provider-web.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function contentToText(content) {
  if (Array.isArray(content)) {
    return content.map((p) => (typeof p === 'string' ? p : p?.text ?? '')).join('');
  }
  return String(content ?? '');
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

  const { instructions, messages: modelMessages } = splitPrompt(messages);
  const prompt = [
    ...(instructions ? [{ role: 'system', content: instructions }] : []),
    ...modelMessages,
  ];
  const built = flattenV4Prompt(prompt);

  return NextResponse.json({
    ok: true,
    notes: [
      'Prompt mentah persis seperti yang dikirim ke provider web (setelah flatten + tagging).',
      'Definisi tool (body.tools) diinjeksi oleh middleware qwen3coder TIDAK dicetak di sini.',
      'Penjelasan lengkap: app/api/chat/completions/BUILD_PROMPT.md',
    ],
    stages: {
      instructionSystem: instructions ?? null,
      modelMessageCount: modelMessages.length,
      lastRole: modelMessages.at(-1)?.role ?? null,
    },
    prompt: built,
    stats: { chars: built.length, lines: built.split('\n').length },
  });
}

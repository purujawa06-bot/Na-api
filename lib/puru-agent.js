/**
 * Puru AI Agent — native ToolLoopAgent (ai SDK v7).
 *
 * Alur sesuai permintaan:
 *  1. Sebelum turn → potong history + pruneMessages agar konteks free.
 *  2. Turn + looping terus-menerus via ToolLoopAgent sampai berhenti sendiri
 *     (stopWhen: stepCountIs).
 *  3. Kirim jawaban akhir (result.text).
 *
 * Dipakai oleh: app/api/puru-ai/route.js (server-side agentic loop, SSE JSON-lines).
 * Tools (zod single-source-of-truth): lib/puru-ai-tools.js TOOL_REGISTRY.
 * Eksekutor: lib/puru-tools.js executeTool.
 * Model: lib/agent-step.js buildModel (adapter web + hermes middleware).
 */
import { ToolLoopAgent, stepCountIs, tool, zodSchema, pruneMessages as aiPruneMessages } from 'ai';
import { splitPrompt, buildModel } from './agent-step.js';
import { TOOL_REGISTRY } from './puru-ai-tools.js';
import { loadDocs, executeTool } from './puru-tools.js';
import settingsService from './settingsService.js';
import { pruneMessages as pruneOpenAiHistory } from './puru-ai-prune.js';

const MAX_HISTORY_USERS = 10;
const MAX_STEPS_DEFAULT = 8;

function buildDocsSummary(docs) {
  try {
    return Object.entries(docs || {})
      .map(([cat, eps]) => {
        const list = (Array.isArray(eps) ? eps : [])
          .map((e) => `  • ${e.method} ${e.path} — ${e.title || ''}`)
          .join('\n');
        return `[${cat}]\n${list}`;
      })
      .join('\n\n');
  } catch {
    return '';
  }
}

function buildInstructions(docsSummary, totalEndpoints, categories) {
  const docsBlock = docsSummary
    ? ` (${totalEndpoints} endpoints in ${categories.length} categories: ${categories.join(', ')})`
    : '';
  return `You are Puru AI — an intelligent assistant built on the PuruBoy API platform.

You have access to tools that let you search the web, crawl web pages, and query the PuruBoy API documentation.

## Capabilities
- **search_web**: Search the internet via Bing for general knowledge, news, facts
- **crawl_web**: Fetch and read content from any URL
- **search_docs**: Search through PuruBoy API documentation${docsBlock}
- **endpoint_info**: Get detailed info about a specific API endpoint (path must start with /api/)
- **fetch**: Make HTTP requests to any URL (useful for testing APIs)

## Guidelines
- For questions about PuruBoy API, always search docs first using search_docs or endpoint_info
- For general knowledge questions, use search_web
- If a user asks about a specific API endpoint, use endpoint_info to get the full specification
- When showing API examples, include the full fetch() code
- Answer in the language the user uses (Indonesian/English)
- Be concise but thorough
- Use markdown formatting for readability (code blocks, lists, bold, etc.)
- If a tool fails, explain the error and try an alternative approach
- You can call multiple tools in sequence to gather all needed information`;
}

/**
 * Bangun tools native AI SDK dari TOOL_REGISTRY (zod schemas) + eksekutor server.
 * @param {object} docs - docs.json yang sudah di-load
 * @param {string} docsSummary - ringkasan docs untuk deskripsi search_docs
 * @param {Array} collected - array output untuk menampung {id, name, args, result}
 */
export function buildAgentTools(docs, docsSummary, collected) {
  const tools = {};
  for (const [name, def] of Object.entries(TOOL_REGISTRY)) {
    let desc = def.description;
    if (name === 'search_docs') {
      desc = docsSummary
        ? `Cari endpoint di dokumentasi PuruBoy API.\n\nDaftar endpoint:\n${docsSummary}\n\nCari berdasarkan kata kunci (judul, path, atau deskripsi).`
        : 'Cari endpoint di dokumentasi PuruBoy API. Cari berdasarkan kata kunci (judul, path, atau deskripsi endpoint).';
    }
    tools[name] = tool({
      description: desc,
      inputSchema: zodSchema(def.schema),
      execute: async (input) => {
        const args = input || {};
        const entry = { id: `call_${Math.random().toString(36).slice(2)}`, name, args };
        collected.push(entry);
        try {
          entry.result = await executeTool(name, args, docs);
        } catch (e) {
          entry.result = JSON.stringify({ error: e?.message || 'Tool execution failed' });
        }
        return entry.result;
      },
    });
  }
  return tools;
}

/**
 * Potong history (OpenAI format) SEBELUM turn agar konteks free:
 * - batasi max user messages (potong dari awal)
 * - prune tool results lama (via lib/puru-ai-prune.js)
 */
export function trimHistoryForTurn(openAiMessages) {
  try {
    return (
      pruneOpenAiHistory(openAiMessages, {
        maxUserMessages: MAX_HISTORY_USERS,
        keepRecent: 3,
        maxToolResultChars: 2000,
      }) || openAiMessages
    );
  } catch {
    return openAiMessages;
  }
}

/**
 * Jalankan agentic loop sampai ToolLoopAgent berhenti sendiri.
 * @param {Array} userMessages - pesan OpenAI [{role, content}] (tanpa system)
 * @param {object} [opts]
 * @param {string} [opts.model='auto']
 * @param {number} [opts.maxSteps=8]
 * @returns {Promise<{type,text,reasoning,model,toolCalls,finishReason,steps}>}
 */
export async function runPuruAgent(userMessages, { model = 'auto', maxSteps = MAX_STEPS_DEFAULT } = {}) {
  const docs = await loadDocs();
  const categories = Object.keys(docs || {});
  const totalEndpoints = Object.values(docs || {}).flat().length;
  const docsSummary = buildDocsSummary(docs);
  const instructions = buildInstructions(docsSummary, totalEndpoints, categories);

  // ─── 1. Potong history + prune SEBELUM turn ───
  const trimmed = trimHistoryForTurn([{ role: 'system', content: instructions }, ...(userMessages || [])]);
  const { instructions: splitInstructions, messages: modelMessages } = splitPrompt(trimmed);

  const collected = [];
  const agentTools = buildAgentTools(docs, docsSummary, collected);

  const meta = {};
  const autoChain = model === 'auto' ? await settingsService.getAutoChain() : undefined;
  const lm = buildModel(model, { tools: agentTools, meta, chain: autoChain });

  // ─── 2. Turn + looping terus-menerus sampai ToolLoopAgent berhenti ───
  const agent = new ToolLoopAgent({
    model: lm,
    instructions: splitInstructions || instructions,
    tools: agentTools,
    stopWhen: stepCountIs(maxSteps),
    prepareStep: async ({ messages }) => {
      // Prune tiap step agar konteks tetap free selama loop berjalan.
      try {
        const pruned = aiPruneMessages({ messages, toolCalls: [{ type: 'before-last-5-messages' }] });
        if (Array.isArray(pruned)) return { messages: pruned };
      } catch {
        /* abaikan — lanjut dengan messages asli */
      }
      return {};
    },
  });

  const result = await agent.generate({ messages: modelMessages });

  let reasoning = '';
  try {
    for (const step of result.steps ?? []) {
      for (const c of step.content ?? []) {
        if (c?.type === 'reasoning' && c.text) reasoning += c.text;
      }
    }
  } catch {
    /* abaikan */
  }

  // ─── 3. Jawaban akhir ───
  return {
    type: 'final',
    text: result.text || '',
    reasoning: reasoning || null,
    model: meta.used || model,
    toolCalls: collected,
    finishReason: 'stop',
    steps: result.steps?.length ?? 0,
  };
}

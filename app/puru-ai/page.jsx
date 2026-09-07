'use client';

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import Link from 'next/link';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/* ═══════════════════════════════════════════════════════════════
   Puru AI — Chat dengan AI + Tools
   
   Agentic loop SEPENUHNYA di sisi client:
   - Panggil /api/chat/completions dengan stream: true + tools
   - Jika AI meminta tool call → eksekusi via /api/tools/execute
   - Kirim hasil tool kembali ke AI → ulangi sampai AI berhenti
     mengirim function calling (maks 50 iterasi)
   - History dibatasi maks 10 entry chat user agar hemat token
   ═══════════════════════════════════════════════════════════════ */

const API_URL = '/api/chat/completions';
const TOOL_EXEC_URL = '/api/tools/execute';
const STORAGE_KEY = 'puru-ai-history';
const MAX_LOOPS = 50;
const MAX_USER_HISTORY = 10;

const SYSTEM_PROMPT = `You are Puru AI — an intelligent assistant built on the PuruBoy API platform.

You have access to tools that let you search the web, crawl web pages, and query the PuruBoy API documentation.

## Capabilities
- **search_web**: Search the internet via Bing for general knowledge, news, facts
- **crawl_web**: Fetch and read content from any URL
- **search_docs**: Search through PuruBoy API documentation
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

const SUGGESTIONS = [
  { icon: '🔍', text: 'Apa itu PuruBoy API?' },
  { icon: '🌐', text: 'Cari tutorial React terbaru' },
  { icon: '📡', text: 'Bagaimana cara pakai YouTube downloader API?' },
  { icon: '💡', text: 'Buat contoh integrasi TikTok downloader' },
  { icon: '🤖', text: 'Model AI apa saja yang tersedia?' },
  { icon: '📖', text: 'Jelaskan semua endpoint yang tersedia' },
];

/* ══════════════════════ Markdown Renderer ══════════════════════ */

function CodeBlock({ node, inline, className, children, ...props }) {
  const [copied, setCopied] = useState(false);
  const match = /language-(\w+)/.exec(className || '');
  const lang = match ? match[1] : '';
  const code = String(children).replace(/\n$/, '');

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (inline) {
    return (
      <code className="bg-[#2a2b30] text-[#e879f9] px-1.5 py-0.5 rounded text-[13px] font-mono" {...props}>
        {children}
      </code>
    );
  }

  return (
    <div className="relative group my-3 rounded-xl overflow-hidden border border-[#2a2b30]">
      {lang && (
        <div className="flex items-center justify-between bg-[#1a1b1f] px-4 py-1.5 border-b border-[#2a2b30]">
          <span className="text-[11px] text-[#6b7280] font-mono uppercase">{lang}</span>
          <button
            onClick={handleCopy}
            className="text-[11px] text-[#6b7280] hover:text-white flex items-center gap-1 transition-colors"
          >
            <i className={`fas ${copied ? 'fa-check text-green-400' : 'fa-copy'}`} />
            {copied ? 'Copied!' : 'Copy'}
          </button>
        </div>
      )}
      {!lang && (
        <button
          onClick={handleCopy}
          className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 text-[11px] text-[#6b7280] hover:text-white bg-[#1a1b1f] px-2 py-1 rounded transition-all"
        >
          <i className={`fas ${copied ? 'fa-check text-green-400' : 'fa-copy'}`} />
        </button>
      )}
      <pre className="bg-[#0d0e11] p-4 overflow-x-auto text-[13px] leading-relaxed">
        <code className={`font-mono text-[#e4e4e7] ${className || ''}`} {...props}>
          {children}
        </code>
      </pre>
    </div>
  );
}

function MarkdownContent({ content }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        code: CodeBlock,
        a: ({ node, children, href, ...props }) => (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[#a78bfa] hover:text-[#c4b5fd] underline underline-offset-2 decoration-[#a78bfa]/30 hover:decoration-[#a78bfa] transition-colors"
            {...props}
          >
            {children}
          </a>
        ),
        p: ({ children }) => (
          <p className="mb-3 last:mb-0 leading-relaxed">{children}</p>
        ),
        ul: ({ children }) => (
          <ul className="list-disc list-inside mb-3 space-y-1 text-[#d4d4d8]">{children}</ul>
        ),
        ol: ({ children }) => (
          <ol className="list-decimal list-inside mb-3 space-y-1 text-[#d4d4d8]">{children}</ol>
        ),
        li: ({ children }) => <li className="leading-relaxed">{children}</li>,
        h1: ({ children }) => <h1 className="text-xl font-bold text-white mb-3 mt-4">{children}</h1>,
        h2: ({ children }) => <h2 className="text-lg font-bold text-white mb-2 mt-3">{children}</h2>,
        h3: ({ children }) => <h3 className="text-base font-bold text-white mb-2 mt-3">{children}</h3>,
        blockquote: ({ children }) => (
          <blockquote className="border-l-4 border-[#a78bfa] pl-4 my-3 text-[#a1a1aa] italic">{children}</blockquote>
        ),
        table: ({ children }) => (
          <div className="overflow-x-auto my-3 rounded-lg border border-[#2a2b30]">
            <table className="w-full text-sm">{children}</table>
          </div>
        ),
        thead: ({ children }) => <thead className="bg-[#1a1b1f]">{children}</thead>,
        th: ({ children }) => (
          <th className="px-3 py-2 text-left text-[#a1a1aa] font-semibold border-b border-[#2a2b30]">{children}</th>
        ),
        td: ({ children }) => (
          <td className="px-3 py-2 text-[#d4d4d8] border-b border-[#2a2b30]/50">{children}</td>
        ),
        hr: () => <hr className="border-[#2a2b30] my-4" />,
        strong: ({ children }) => <strong className="text-white font-semibold">{children}</strong>,
        em: ({ children }) => <em className="text-[#d4d4d8]">{children}</em>,
      }}
    >
      {content}
    </ReactMarkdown>
  );
}

/* ══════════════════════ Tool Card ══════════════════════ */

function ToolCard({ tool }) {
  const [open, setOpen] = useState(false);
  const icon = {
    search_web: 'fa-search',
    crawl_web: 'fa-spider',
    search_docs: 'fa-book',
    endpoint_info: 'fa-circle-info',
    fetch: 'fa-plug',
  }[tool.name] || 'fa-wrench';

  let argsDisplay = '';
  try {
    const a = typeof tool.args === 'string' ? JSON.parse(tool.args) : tool.args;
    argsDisplay = Object.entries(a)
      .map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`)
      .join(', ');
  } catch {
    argsDisplay = typeof tool.args === 'string' ? tool.args : JSON.stringify(tool.args);
  }

  return (
    <div className="my-2 rounded-lg border border-[#2a2b30] overflow-hidden bg-[#141517]">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-[#1a1b1f] transition-colors text-left"
      >
        <div className="w-6 h-6 rounded bg-[#a78bfa]/10 flex items-center justify-center flex-shrink-0">
          {tool.status === 'running' ? (
            <i className="fas fa-spinner fa-spin text-[10px] text-[#a78bfa]" />
          ) : (
            <i className={`fas ${icon} text-[10px] text-[#a78bfa]`} />
          )}
        </div>
        <span className="text-[12px] text-[#a1a1aa] flex-1 truncate">
          <span className="text-[#d4d4d8] font-medium">{tool.name}</span>
          <span className="mx-1.5 text-[#3f3f46]">·</span>
          <span className="text-[#71717a]">{argsDisplay.slice(0, 60)}{argsDisplay.length > 60 ? '…' : ''}</span>
        </span>
        <i className={`fas fa-chevron-${open ? 'up' : 'down'} text-[10px] text-[#52525b]`} />
      </button>
      {open && (
        <div className="border-t border-[#2a2b30] p-3 space-y-2">
          <div>
            <span className="text-[10px] uppercase tracking-wider text-[#52525b] font-bold">Arguments</span>
            <pre className="text-[12px] text-[#a1a1aa] mt-1 overflow-x-auto font-mono whitespace-pre-wrap break-all">
              {argsDisplay}
            </pre>
          </div>
          {tool.result && (
            <div>
              <span className="text-[10px] uppercase tracking-wider text-[#52525b] font-bold">Result</span>
              <pre className="text-[12px] text-[#a1a1aa] mt-1 overflow-x-auto font-mono max-h-48 overflow-y-auto custom-scrollbar whitespace-pre-wrap break-all">
                {typeof tool.result === 'string'
                  ? tool.result.slice(0, 2000) + (tool.result.length > 2000 ? '\n... (truncated)' : '')
                  : JSON.stringify(tool.result, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ══════════════════════ Message Bubble ══════════════════════ */

function MessageBubble({ msg }) {
  const isUser = msg.role === 'user';

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-4 group px-4`}>
      <div className={`max-w-[85%] md:max-w-[72%] ${isUser ? 'order-2' : 'order-1'}`}>
        {/* Assistant label */}
        {!isUser && (
          <div className="flex items-center gap-2 mb-1.5 ml-1">
            <div className="w-5 h-5 rounded bg-[#a78bfa] flex items-center justify-center">
              <i className="fas fa-bolt text-[9px] text-white" />
            </div>
            <span className="text-[11px] font-bold text-[#71717a]">Puru AI</span>
          </div>
        )}

        {/* Content */}
        <div
          className={`rounded-2xl px-4 py-3 text-[14px] leading-relaxed ${
            isUser
              ? 'bg-[#a78bfa] text-white rounded-br-md'
              : 'bg-[#1a1b1f] text-[#d4d4d8] rounded-bl-md border border-[#2a2b30]'
          }`}
        >
          {isUser ? (
            <p className="whitespace-pre-wrap">{msg.content}</p>
          ) : (
            <>
              {/* Reasoning (collapsible) */}
              {msg.reasoning && (
                <details className="mb-2 text-[12px] bg-[#141517] border border-[#2a2b30] rounded-lg px-3 py-2">
                  <summary className="cursor-pointer select-none flex items-center gap-2 font-medium text-[#71717a]">
                    <i className="fas fa-brain text-[10px] text-[#a78bfa]" />
                    Thinking
                  </summary>
                  <p className="mt-2 whitespace-pre-wrap text-[#a1a1aa] leading-relaxed">{msg.reasoning}</p>
                </details>
              )}

              {msg.content ? (
                <div className="prose-dark">
                  <MarkdownContent content={msg.content} />
                </div>
              ) : msg.streaming ? (
                <div className="flex items-center gap-1.5">
                  <div className="w-2 h-2 bg-[#a78bfa] rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                  <div className="w-2 h-2 bg-[#a78bfa] rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                  <div className="w-2 h-2 bg-[#a78bfa] rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
              ) : null}

              {/* Streaming cursor */}
              {msg.streaming && msg.content && (
                <span className="inline-block w-0.5 h-4 bg-[#a78bfa] ml-0.5 animate-pulse align-middle" />
              )}
            </>
          )}
        </div>

        {/* Tool calls */}
        {msg.toolCalls && msg.toolCalls.length > 0 && (
          <div className="mt-2 space-y-1">
            {msg.toolCalls.map((tc, i) => (
              <ToolCard key={tc.id || i} tool={tc} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ══════════════════════ Helpers ══════════════════════ */

function safeParseArgs(args) {
  if (typeof args === 'object' && args !== null) return args;
  try { return JSON.parse(args || '{}'); } catch { return {}; }
}

/** Batasi history API ke maks MAX_USER_HISTORY entry chat user. */
function limitUserHistory(msgs) {
  const userIdx = [];
  msgs.forEach((m, i) => { if (m.role === 'user') userIdx.push(i); });
  if (userIdx.length <= MAX_USER_HISTORY) return msgs;
  return msgs.slice(userIdx[userIdx.length - MAX_USER_HISTORY]);
}

/**
 * Streaming satu langkah agent via /api/chat/completions (SSE OpenAI).
 * Mengembalikan { text, reasoning, toolCalls, finishReason }.
 */
async function streamChatCompletion({ messages, tools, signal, onDelta }) {
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'auto', stream: true, messages, tools }),
    signal,
  });

  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const j = await res.json();
      msg = j?.error?.message || msg;
    } catch { /* ignore */ }
    throw new Error(msg);
  }

  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let text = '';
  let reasoning = '';
  const toolCalls = [];
  let finishReason = 'stop';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const parts = buf.split('\n\n');
    buf = parts.pop();
    for (const part of parts) {
      const trimmed = part.trim();
      if (!trimmed.startsWith('data:')) continue;
      const payload = trimmed.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;
      let json;
      try { json = JSON.parse(payload); } catch { continue; }
      if (json.error) throw new Error(json.error.message || 'Stream error');
      const choice = json.choices?.[0];
      if (!choice) continue;
      if (choice.finish_reason) finishReason = choice.finish_reason;
      const delta = choice.delta || {};

      if (delta.reasoning_content) {
        const r = delta.reasoning_content;
        // Abaikan keep-alive palsu dari server saat fallback provider
        if (!r.startsWith('[menunggu respons provider')) {
          reasoning += r;
          onDelta?.({ type: 'reasoning', content: r });
        }
      }
      if (delta.content) {
        text += delta.content;
        onDelta?.({ type: 'text', content: delta.content });
      }
      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index ?? 0;
          if (!toolCalls[idx]) toolCalls[idx] = { id: '', name: '', arguments: '' };
          if (tc.id) toolCalls[idx].id = tc.id;
          if (tc.function?.name) toolCalls[idx].name += tc.function.name;
          if (tc.function?.arguments) toolCalls[idx].arguments += tc.function.arguments;
        }
      }
    }
  }

  return {
    text,
    reasoning,
    finishReason,
    toolCalls: toolCalls.filter(Boolean).map((tc) => ({
      id: tc.id || `call_${Math.random().toString(36).slice(2)}`,
      name: tc.name,
      arguments: tc.arguments,
    })),
  };
}

/** Eksekusi satu tool call via /api/tools/execute. */
async function executeToolClient(tool) {
  const args = safeParseArgs(tool.arguments);
  const res = await fetch(TOOL_EXEC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: tool.name, args }),
  });
  let j;
  try { j = await res.json(); } catch { j = {}; }
  if (!res.ok || !j.success) {
    return JSON.stringify({ error: j?.error || `Tool ${tool.name} gagal dieksekusi` });
  }
  return j.result;
}

/* ══════════════════════ Main Page ══════════════════════ */

export default function PuruAIPage() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [isExiting, setIsExiting] = useState(false);
  const [docsSummary, setDocsSummary] = useState('');
  const scrollRef = useRef(null);
  const inputRef = useRef(null);
  const abortRef = useRef(null);
  const loadingRef = useRef(false);

  // Ambil ringkasan docs.json agar tool search_docs tahu daftar endpoint
  useEffect(() => {
    fetch('/docs.json')
      .then((r) => r.json())
      .then((data) => {
        if (data && typeof data === 'object') {
          const lines = Object.entries(data).map(([cat, eps]) => {
            const list = (Array.isArray(eps) ? eps : [])
              .map((e) => `  • ${e.method} ${e.path} — ${e.title || ''}`)
              .join('\n');
            return `[${cat}]\n${list}`;
          });
          setDocsSummary(lines.join('\n\n'));
        }
      })
      .catch(() => {});
  }, []);

  // Tool definitions (search_docs memuat daftar endpoint dari docs.json)
  const TOOLS = useMemo(() => {
    const categories = docsSummary
      .split('\n\n')
      .map((l) => l.replace(/^\[|\]$/g, ''))
      .filter(Boolean);
    const searchDocsDesc = docsSummary
      ? `Cari endpoint di dokumentasi PuruBoy API. Gunakan untuk pertanyaan tentang cara pakai API ini. Kategori tersedia: ${categories.join(', ')}.\n\nDaftar endpoint:\n${docsSummary}\n\nCari berdasarkan kata kunci (judul, path, atau deskripsi).`
      : 'Cari endpoint di dokumentasi PuruBoy API. Gunakan untuk pertanyaan tentang cara pakai API ini. Cari berdasarkan kata kunci (judul, path, atau deskripsi endpoint).';

    return [
      {
        type: 'function',
        function: {
          name: 'search_web',
          description: 'Cari informasi di internet via Bing. Gunakan untuk pertanyaan umum, berita, fakta terkini, atau topik yang tidak terkait PuruBoy API.',
          parameters: {
            type: 'object',
            properties: {
              query: { type: 'string', description: 'Kata kunci pencarian' },
              limit: { type: 'number', description: 'Jumlah hasil (default 5, maks 10)' },
            },
            required: ['query'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'crawl_web',
          description: 'Ambil dan ekstrak teks dari sebuah URL. Berguna untuk membaca artikel, dokumentasi, atau halaman web tertentu.',
          parameters: {
            type: 'object',
            properties: {
              url: { type: 'string', description: 'URL halaman web yang ingin dibaca' },
              maxChars: { type: 'number', description: 'Maks karakter yang diambil (default 8000)' },
            },
            required: ['url'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'search_docs',
          description: searchDocsDesc,
          parameters: {
            type: 'object',
            properties: {
              query: { type: 'string', description: 'Kata kunci pencarian (judul, path, atau deskripsi endpoint)' },
            },
            required: ['query'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'endpoint_info',
          description: 'Ambil informasi lengkap satu endpoint: method, path, params, example. Path harus diawali /api/',
          parameters: {
            type: 'object',
            properties: {
              path: { type: 'string', description: 'Path endpoint, contoh: /api/search/duckduckgo' },
            },
            required: ['path'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'fetch',
          description: 'Fetch URL apapun dengan method HTTP apapun. Berguna untuk testing API endpoint atau mengambil data dari URL tertentu.',
          parameters: {
            type: 'object',
            properties: {
              url: { type: 'string', description: 'URL yang akan di-fetch' },
              method: { type: 'string', description: 'HTTP method (GET, POST, PUT, DELETE). Default GET.' },
              headers: { type: 'object', description: 'HTTP headers (opsional)' },
              body: { description: 'Request body untuk POST/PUT (opsional, string atau object)' },
            },
            required: ['url'],
          },
        },
      },
    ];
  }, [docsSummary]);

  // Load history
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) setMessages(parsed.filter((m) => m.role === 'user' || m.role === 'assistant'));
      }
    } catch { /* ignore */ }
  }, []);

  // Save history (dibatasi 10 user entry)
  const saveHistory = useCallback((msgs) => {
    try {
      const conv = msgs.filter((m) => m.role === 'user' || (m.role === 'assistant' && m.content));
      localStorage.setItem(STORAGE_KEY, JSON.stringify(limitUserHistory(conv)));
    } catch { /* ignore */ }
  }, []);

  // Auto scroll
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const sendMessage = useCallback(async (text) => {
    if (!text.trim() || loadingRef.current) return;
    const userMsg = { role: 'user', content: text.trim(), id: Date.now() };
    const assistantMsg = {
      role: 'assistant',
      content: '',
      id: Date.now() + 1,
      toolCalls: [],
      streaming: true,
      reasoning: '',
    };

    const updated = [...messages, userMsg, assistantMsg];
    setMessages(updated);
    setInput('');
    setLoading(true);
    loadingRef.current = true;

    const abort = new AbortController();
    abortRef.current = abort;

    // Konteks API: system prompt + history user/assistant (maks 10 user entry)
    const apiMessages = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...limitUserHistory(
        [...messages, userMsg]
          .filter((m) => m.role === 'user' || (m.role === 'assistant' && m.content))
          .map((m) => ({ role: m.role, content: m.content })),
      ),
    ];

    const updateAssistant = (patch) => {
      setMessages((prev) => {
        const copy = [...prev];
        const last = { ...copy[copy.length - 1], ...patch };
        copy[copy.length - 1] = last;
        return copy;
      });
    };

    let loopCount = 0;
    let fullText = '';
    let fullReasoning = '';
    const allToolCalls = [];

    try {
      while (loopCount < MAX_LOOPS) {
        loopCount += 1;
        let iterationText = '';
        let iterationReasoning = '';

        const result = await streamChatCompletion({
          messages: apiMessages,
          tools: TOOLS,
          signal: abort.signal,
          onDelta: (d) => {
            if (d.type === 'text') {
              iterationText += d.content;
              updateAssistant({ content: fullText + iterationText, streaming: true });
            } else if (d.type === 'reasoning') {
              iterationReasoning += d.content;
              updateAssistant({ reasoning: fullReasoning + iterationReasoning });
            }
          },
        });

        // Akumulasi teks & reasoning dari iterasi ini
        if (iterationText) {
          fullText = fullText ? `${fullText}\n\n${iterationText}` : iterationText;
        }
        if (iterationReasoning) {
          fullReasoning = fullReasoning ? `${fullReasoning}\n\n${iterationReasoning}` : iterationReasoning;
        }
        updateAssistant({ content: fullText, reasoning: fullReasoning, streaming: true });

        // Tidak ada function calling → loop selesai
        if (!result.toolCalls || result.toolCalls.length === 0) {
          break;
        }

        // Append pesan assistant dengan tool_calls ke konteks API
        apiMessages.push({
          role: 'assistant',
          content: iterationText || null,
          tool_calls: result.toolCalls.map((tc) => ({
            id: tc.id,
            type: 'function',
            function: { name: tc.name, arguments: tc.arguments },
          })),
        });

        // Eksekusi semua tool calls
        for (const tc of result.toolCalls) {
          const card = { id: tc.id, name: tc.name, args: safeParseArgs(tc.arguments), status: 'running' };
          allToolCalls.push(card);
          updateAssistant({ toolCalls: [...allToolCalls] });

          let output;
          try {
            output = await executeToolClient(tc);
          } catch (e) {
            output = JSON.stringify({ error: e.message || 'Tool execution failed' });
          }

          card.result = output;
          card.status = 'done';
          updateAssistant({ toolCalls: [...allToolCalls] });

          apiMessages.push({
            role: 'tool',
            tool_call_id: tc.id,
            name: tc.name,
            content: output,
          });
        }
      }

      if (loopCount >= MAX_LOOPS) {
        updateAssistant({
          content: `${fullText || ''}\n\n> ⚠️ **Loop mencapai batas maksimal (${MAX_LOOPS} iterasi).** Mungkin pertanyaan terlalu kompleks — coba pecah menjadi lebih spesifik.`,
          streaming: false,
        });
      } else {
        updateAssistant({ content: fullText, streaming: false });
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        updateAssistant({
          content: `⚠️ Gagal menghubungi server: ${err.message}`,
          streaming: false,
        });
      } else {
        updateAssistant({ streaming: false });
      }
    } finally {
      setMessages((prev) => {
        const copy = [...prev];
        const last = { ...copy[copy.length - 1] };
        last.streaming = false;
        copy[copy.length - 1] = last;
        saveHistory(copy);
        return copy;
      });
      setLoading(false);
      loadingRef.current = false;
      abortRef.current = null;
    }
  }, [messages, saveHistory, TOOLS]);

  const handleSubmit = (e) => {
    e.preventDefault();
    sendMessage(input);
  };

  const handleSuggestion = (text) => {
    sendMessage(text);
  };

  const handleStop = () => {
    abortRef.current?.abort();
  };

  const handleClear = () => {
    if (confirm('Hapus semua percakapan?')) {
      setMessages([]);
      localStorage.removeItem(STORAGE_KEY);
    }
  };

  const handleBack = () => {
    setIsExiting(true);
    setTimeout(() => { window.location.href = '/'; }, 300);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  const transitionClass = isExiting ? 'animate-slide-out-right' : 'animate-slide-in-right';

  return (
    <div className={`fixed inset-0 z-[100] bg-[#09090b] flex flex-col h-dvh supports-[height:100dvh]:h-[100dvh] ${transitionClass}`}>
      {/* ─── Header ─── */}
      <header className="bg-[#09090b]/80 backdrop-blur-xl border-b border-[#1a1b1f] h-14 flex items-center px-4 justify-between shrink-0 z-30">
        <div className="flex items-center gap-3">
          <button onClick={handleBack} className="text-[#71717a] hover:text-white transition-colors p-1.5">
            <i className="fas fa-arrow-left text-base" />
          </button>
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-[#a78bfa] flex items-center justify-center shadow-lg shadow-[#a78bfa]/20">
              <i className="fas fa-bolt text-xs text-white" />
            </div>
            <div>
              <h1 className="text-sm font-bold text-white leading-tight">Puru AI</h1>
              <p className="text-[10px] text-[#52525b] leading-tight">Powered by PuruBoy API</p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {loading && (
            <button
              onClick={handleStop}
              className="text-[#ef4444] hover:bg-[#1a1b1f] transition-colors p-2 rounded-lg"
              title="Stop"
            >
              <i className="fas fa-stop text-sm" />
            </button>
          )}
          {messages.length > 0 && (
            <button
              onClick={handleClear}
              className="text-[#52525b] hover:text-[#ef4444] transition-colors p-2 rounded-lg hover:bg-[#1a1b1f]"
              title="Clear chat"
            >
              <i className="fas fa-trash-alt text-sm" />
            </button>
          )}
        </div>
      </header>

      {/* ─── Chat Area ─── */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto custom-scrollbar">
        {messages.length === 0 ? (
          /* ─── Empty State ─── */
          <div className="flex flex-col items-center justify-center h-full px-4 py-12">
            <div className="w-20 h-20 rounded-2xl bg-[#a78bfa]/10 flex items-center justify-center mb-6 shadow-2xl shadow-[#a78bfa]/5 border border-[#a78bfa]/20">
              <i className="fas fa-bolt text-3xl text-[#a78bfa]" />
            </div>
            <h2 className="text-2xl font-bold text-white mb-2 text-center">Halo! Saya Puru AI</h2>
            <p className="text-[#71717a] text-sm text-center max-w-sm mb-8 leading-relaxed">
              Asisten AI yang bisa <span className="text-[#a78bfa] font-medium">search web</span>,{' '}
              <span className="text-[#a78bfa] font-medium">baca halaman web</span>, dan{' '}
              <span className="text-[#a78bfa] font-medium">akses dokumentasi PuruBoy API</span> secara langsung.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full max-w-lg">
              {SUGGESTIONS.map((s, i) => (
                <button
                  key={i}
                  onClick={() => handleSuggestion(s.text)}
                  className="flex items-center gap-3 px-4 py-3 rounded-xl bg-[#141517] border border-[#1a1b1f] hover:border-[#a78bfa]/30 hover:bg-[#1a1b1f] transition-all text-left group"
                  disabled={loading}
                >
                  <span className="text-lg flex-shrink-0">{s.icon}</span>
                  <span className="text-[13px] text-[#a1a1aa] group-hover:text-[#d4d4d8] transition-colors">{s.text}</span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          /* ─── Messages ─── */
          <div className="max-w-3xl mx-auto py-4">
            {messages.map((msg) => (
              <MessageBubble key={msg.id} msg={msg} />
            ))}
          </div>
        )}
      </div>

      {/* ─── Input Bar ─── */}
      <div className="shrink-0 border-t border-[#1a1b1f] bg-[#09090b] p-3 md:p-4 z-30">
        <form onSubmit={handleSubmit} className="max-w-3xl mx-auto">
          <div className="relative bg-[#141517] rounded-2xl border border-[#1a1b1f] focus-within:border-[#a78bfa]/40 transition-colors">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Tanya apa saja..."
              rows={1}
              className="w-full bg-transparent text-white placeholder-[#52525b] text-[14px] px-4 py-3 pr-12 resize-none outline-none max-h-32 custom-scrollbar leading-relaxed"
              style={{ minHeight: '44px' }}
              disabled={loading}
              onInput={(e) => {
                e.target.style.height = 'auto';
                e.target.style.height = Math.min(e.target.scrollHeight, 128) + 'px';
              }}
            />
            <button
              type="submit"
              disabled={loading || !input.trim()}
              className={`absolute right-2 bottom-2 w-9 h-9 rounded-xl flex items-center justify-center transition-all ${
                input.trim() && !loading
                  ? 'bg-[#a78bfa] text-white hover:bg-[#9461fb] shadow-lg shadow-[#a78bfa]/20'
                  : 'bg-[#1a1b1f] text-[#3f3f46]'
              }`}
            >
              {loading ? (
                <i className="fas fa-spinner fa-spin text-sm" />
              ) : (
                <i className="fas fa-arrow-up text-sm" />
              )}
            </button>
          </div>
          <p className="text-center text-[10px] text-[#3f3f46] mt-2">
            Puru AI menggunakan AI model + tools · Dapat membuat kesalahan
          </p>
        </form>
      </div>
    </div>
  );
}
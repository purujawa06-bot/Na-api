'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { getToolMeta } from '../../lib/puru-ai-tools';
import { pruneMessages } from '../../lib/puru-ai-prune';

/* ═══════════════════════════════════════════════════════════════
   Puru AI — Chat dengan AI + Tools (Server-side Agentic Loop)

   - Loop: client → /api/puru-ai (SSE JSON-lines) → ToolLoopAgent server
   - Server: potong history + pruneMessages sebelum turn, loop via
     ToolLoopAgent sampai berhenti, kirim jawaban akhir
   - Client: streaming event saja — TIDAK ada loop manual, guard,
     forceStop, atau dedupe lagi
   - History localStorage dibatasi 10 user entry (lib/puru-ai-prune.js)
   ═══════════════════════════════════════════════════════════════ */

const PURU_AI_URL = '/api/puru-ai';
const STORAGE_KEY = 'puru-ai-history';
const MAX_STEPS = 8;

const SUGGESTIONS = [
  { icon: '🔍', text: 'Apa itu PuruBoy API?' },
  { icon: '🌐', text: 'Cari tutorial React terbaru' },
  { icon: '📡', text: 'Bagaimana cara pakai YouTube downloader API?' },
  { icon: '💡', text: 'Buat contoh integrasi TikTok downloader' },
  { icon: '🤖', text: 'Model AI apa saja yang tersedia?' },
  { icon: '📖', text: 'Jelaskan semua endpoint yang tersedia' },
];

/* ══════════════════════ Markdown Renderer ══════════════════════ */

const CodeBlock = React.memo(function CodeBlock({ inline, className, children }) {
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
      <code className="bg-[#2a2b30] text-[#e879f9] px-1.5 py-0.5 rounded text-[12px] font-mono">
        {children}
      </code>
    );
  }

  return (
    <div className="relative group my-3 rounded-xl overflow-hidden border border-[#2a2b30]">
      {lang && (
        <div className="flex items-center justify-between bg-[#1a1b1f] px-4 py-1.5 border-b border-[#2a2b30]">
          <span className="text-[10px] text-[#6b7280] font-mono uppercase">{lang}</span>
          <button
            onClick={handleCopy}
            className="text-[10px] text-[#6b7280] hover:text-white flex items-center gap-1 transition-colors"
          >
            <i className={`fas ${copied ? 'fa-check text-green-400' : 'fa-copy'}`} />
            {copied ? 'Copied!' : 'Copy'}
          </button>
        </div>
      )}
      {!lang && (
        <button
          onClick={handleCopy}
          className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 text-[10px] text-[#6b7280] hover:text-white bg-[#1a1b1f] px-2 py-1 rounded transition-all"
        >
          <i className={`fas ${copied ? 'fa-check text-green-400' : 'fa-copy'}`} />
        </button>
      )}
      <pre className="bg-[#0d0e11] p-4 overflow-x-auto text-[12px] leading-relaxed">
        <code className={`font-mono text-[#e4e4e7] ${className || ''}`}>
          {children}
        </code>
      </pre>
    </div>
  );
});

const MarkdownContent = React.memo(function MarkdownContent({ content }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        code: CodeBlock,
        a: ({ children, href, ...props }) => (
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
          <ul className="list-disc list-outside ml-5 mb-3 space-y-1.5 text-[#d4d4d8]">{children}</ul>
        ),
        ol: ({ children }) => (
          <ol className="list-decimal list-outside ml-5 mb-3 space-y-1.5 text-[#d4d4d8]">{children}</ol>
        ),
        li: ({ children }) => <li className="leading-relaxed pl-1">{children}</li>,
        h1: ({ children }) => <h1 className="text-lg font-bold text-white mb-3 mt-5">{children}</h1>,
        h2: ({ children }) => <h2 className="text-base font-bold text-white mb-2 mt-4">{children}</h2>,
        h3: ({ children }) => <h3 className="text-[15px] font-bold text-white mb-2 mt-3">{children}</h3>,
        blockquote: ({ children }) => (
          <blockquote className="border-l-3 border-[#a78bfa] pl-4 my-3 text-[#a1a1aa] italic">{children}</blockquote>
        ),
        table: ({ children }) => (
          <div className="overflow-x-auto my-3 rounded-lg border border-[#2a2b30]">
            <table className="w-full text-[13px]">{children}</table>
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
});

/* ══════════════════════ Tool Card (individual, inside collapsible) ══════════════════════ */

const ToolCard = React.memo(function ToolCard({ tool }) {
  const [open, setOpen] = useState(false);
  const meta = getToolMeta(tool.name);

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
    <div className="rounded-lg border border-[#2a2b30] overflow-hidden bg-[#0d0e11]">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-[#1a1b1f] transition-colors text-left"
      >
        <div className="w-5 h-5 rounded bg-[#a78bfa]/10 flex items-center justify-center flex-shrink-0">
          {tool.status === 'running' ? (
            <i className="fas fa-spinner fa-spin text-[9px] text-[#a78bfa]" />
          ) : (
            <i className={`fas ${meta.icon} text-[9px] text-[#a78bfa]`} />
          )}
        </div>
        <span className="text-[11px] text-[#a1a1aa] flex-1 truncate">
          <span className="text-[#d4d4d8] font-medium">{tool.name}</span>
          <span className="mx-1 text-[#3f3f46]">·</span>
          <span className="text-[#71717a]">{argsDisplay.slice(0, 50)}{argsDisplay.length > 50 ? '…' : ''}</span>
        </span>
        <i className={`fas fa-chevron-${open ? 'up' : 'down'} text-[9px] text-[#52525b]`} />
      </button>
      {open && (
        <div className="border-t border-[#2a2b30] p-3 space-y-2">
          <div>
            <span className="text-[10px] uppercase tracking-wider text-[#52525b] font-bold">Arguments</span>
            <pre className="text-[11px] text-[#a1a1aa] mt-1 overflow-x-auto font-mono whitespace-pre-wrap break-all">
              {argsDisplay}
            </pre>
          </div>
          {tool.result && (
            <div>
              <span className="text-[10px] uppercase tracking-wider text-[#52525b] font-bold">Result</span>
              <pre className="text-[11px] text-[#a1a1aa] mt-1 overflow-x-auto font-mono max-h-48 overflow-y-auto custom-scrollbar whitespace-pre-wrap break-all">
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
});

/* ══════════════════════ Tool Calls Section (ABOVE bubble) ══════════════════════ */

function ToolCallsSection({ toolCalls }) {
  const [open, setOpen] = useState(false);

  if (!toolCalls || toolCalls.length === 0) return null;

  const completedCount = toolCalls.filter((t) => t.status === 'done').length;
  const runningCount = toolCalls.filter((t) => t.status === 'running').length;

  return (
    <div className="mb-2">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[#141517] border border-[#2a2b30] hover:border-[#a78bfa]/30 transition-all w-full text-left group"
      >
        <div className="w-5 h-5 rounded bg-[#a78bfa]/10 flex items-center justify-center flex-shrink-0">
          {runningCount > 0 ? (
            <i className="fas fa-spinner fa-spin text-[9px] text-[#a78bfa]" />
          ) : (
            <i className="fas fa-wrench text-[9px] text-[#a78bfa]" />
          )}
        </div>
        <span className="text-[12px] text-[#a1a1aa] flex-1">
          {runningCount > 0 ? (
            <span className="text-[#a78bfa]">Menggunakan {runningCount} tool…</span>
          ) : (
            <>Lihat {completedCount} tool yang digunakan</>
          )}
        </span>
        <i className={`fas fa-chevron-${open ? 'up' : 'down'} text-[10px] text-[#52525b] group-hover:text-[#a78bfa] transition-colors`} />
      </button>
      {open && (
        <div className="mt-2 space-y-1.5 pl-1">
          {toolCalls.map((tc, i) => (
            <ToolCard key={tc.id || i} tool={tc} />
          ))}
        </div>
      )}
    </div>
  );
}

/* ══════════════════════ Message Bubble ══════════════════════ */

const MessageBubble = React.memo(function MessageBubble({ msg }) {
  const isUser = msg.role === 'user';

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-6 group px-4 md:px-6`}>
      <div className={`max-w-[88%] md:max-w-[78%] ${isUser ? 'order-2' : 'order-1'}`}>
        {/* Assistant label */}
        {!isUser && (
          <div className="flex items-center gap-2 mb-2 ml-1">
            <div className="w-6 h-6 rounded-lg bg-[#a78bfa] flex items-center justify-center">
              <i className="fas fa-bolt text-[10px] text-white" />
            </div>
            <span className="text-[11px] font-semibold text-[#71717a]">Puru AI</span>
          </div>
        )}

        {/* Tool Calls — ATAS bubble */}
        {!isUser && msg.toolCalls && msg.toolCalls.length > 0 && (
          <ToolCallsSection toolCalls={msg.toolCalls} />
        )}

        {/* Content bubble */}
        <div
          className={`px-5 py-4 text-[13.5px] leading-[1.75] ${
            isUser
              ? 'bg-[#a78bfa] text-white rounded-2xl rounded-br-lg'
              : 'bg-[#1a1b1f] text-[#d4d4d8] rounded-2xl rounded-bl-lg border border-[#2a2b30]'
          }`}
        >
          {isUser ? (
            <p className="whitespace-pre-wrap">{msg.content}</p>
          ) : (
            <>
              {/* Reasoning (collapsible) */}
              {msg.reasoning && (
                <details className="mb-3 text-[12px] bg-[#141517] border border-[#2a2b30] rounded-lg px-3 py-2">
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
                <div className="flex items-center gap-2 py-1">
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
      </div>
    </div>
  );
});

/* ══════════════════════ Helpers ══════════════════════ */

/**
 * Streaming dari /api/puru-ai (SSE JSON-lines, satu objek per baris).
 * Server menjalankan ToolLoopAgent sampai berhenti lalu mengirim:
 *   thinking → reasoning, tools/tools_done → tool calls,
 *   text → potongan jawaban akhir, done → selesai, error → gagal.
 */
async function streamPuruAI({ messages, model = 'auto', maxSteps = MAX_STEPS, signal, onEvent }) {
  const res = await fetch(PURU_AI_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages, maxSteps }),
    signal,
  });

  if (!res.ok) {
    let msg = 'HTTP ' + res.status;
    try {
      const j = await res.json();
      msg = j?.error || msg;
    } catch { /* ignore */ }
    throw new Error(msg);
  }

  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let fullText = '';
  let fullReasoning = '';
  const toolCalls = [];
  let usedModel = model;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop();
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let evt;
      try { evt = JSON.parse(trimmed); } catch { continue; }
      if (evt.type === 'thinking' && evt.content) {
        fullReasoning += evt.content;
        onEvent?.({ type: 'reasoning', content: evt.content });
      } else if ((evt.type === 'tools' || evt.type === 'tools_done') && Array.isArray(evt.tools)) {
        for (const t of evt.tools) {
          toolCalls.push({
            id: t.id || ('call_' + Math.random().toString(36).slice(2)),
            name: t.name,
            args: t.args || {},
            result: t.result,
            status: 'done',
          });
        }
        onEvent?.({ type: 'tools', toolCalls: [...toolCalls] });
      } else if (evt.type === 'text' && evt.content) {
        fullText += evt.content;
        onEvent?.({ type: 'text', content: evt.content });
      } else if (evt.type === 'done') {
        if (evt.model) usedModel = evt.model;
      } else if (evt.type === 'error') {
        throw new Error(evt.message || 'Server error');
      }
    }
  }

  return { text: fullText, reasoning: fullReasoning, toolCalls, model: usedModel };
}

/* ══════════════════════ Main Page ══════════════════════ */

export default function PuruAIPage() {
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [isExiting, setIsExiting] = useState(false);

  // Input via refs (tidak trigger re-render per keystroke)
  const inputRefEl = useRef(null);
  const inputValueRef = useRef('');
  const [inputDraft, setInputDraft] = useState('');

  const scrollRef = useRef(null);
  const abortRef = useRef(null);
  const loadingRef = useRef(false);

  // Batched state update via rAF
  const rafRef = useRef(null);
  const pendingPatchRef = useRef(null);

  const flushPatch = useCallback(() => {
    rafRef.current = null;
    const patch = pendingPatchRef.current;
    pendingPatchRef.current = null;
    if (patch) {
      setMessages((prev) => {
        const copy = [...prev];
        const last = { ...copy[copy.length - 1], ...patch };
        copy[copy.length - 1] = last;
        return copy;
      });
    }
  }, []);

  const scheduleUpdate = useCallback((patch) => {
    pendingPatchRef.current = { ...(pendingPatchRef.current || {}), ...patch };
    if (!rafRef.current) {
      rafRef.current = requestAnimationFrame(flushPatch);
    }
  }, [flushPatch]);

  useEffect(() => {
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, []);



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
      localStorage.setItem(STORAGE_KEY, JSON.stringify(pruneMessages(conv, { maxUserMessages: 10 })));
    } catch { /* ignore */ }
  }, []);

  // Auto scroll
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // Input change handler
  const inputTimeoutRef = useRef(null);
  const handleInputChange = useCallback((e) => {
    const val = e.target.value;
    inputValueRef.current = val;
    e.target.style.height = 'auto';
    e.target.style.height = Math.min(e.target.scrollHeight, 160) + 'px';
    if (inputTimeoutRef.current) clearTimeout(inputTimeoutRef.current);
    inputTimeoutRef.current = setTimeout(() => setInputDraft(val), 60);
  }, []);

  // ─── Server-side Agentic Loop (ToolLoopAgent) — client hanya streaming event ───
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

    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    inputValueRef.current = '';
    setInputDraft('');
    if (inputRefEl.current) {
      inputRefEl.current.value = '';
      inputRefEl.current.style.height = 'auto';
    }
    setLoading(true);
    loadingRef.current = true;

    const abort = new AbortController();
    abortRef.current = abort;

    // History untuk server: user/assistant text saja
    // (server potong history + pruneMessages lagi sebelum turn agar konteks free)
    const historyMessages = [...messages, userMsg]
      .filter((m) => m.role === 'user' || (m.role === 'assistant' && m.content))
      .map((m) => ({ role: m.role, content: m.content }));

    try {
      let fullText = '';
      let fullReasoning = '';

      const result = await streamPuruAI({
        messages: historyMessages,
        model: 'auto',
        maxSteps: MAX_STEPS,
        signal: abort.signal,
        onEvent: (e) => {
          if (e.type === 'text') {
            fullText += e.content;
            scheduleUpdate({ content: fullText, streaming: true });
          } else if (e.type === 'reasoning') {
            fullReasoning += e.content;
            scheduleUpdate({ reasoning: fullReasoning });
          } else if (e.type === 'tools') {
            scheduleUpdate({ toolCalls: e.toolCalls });
          }
        },
      });

      // Force flush pending rAF
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }

      setMessages((prev) => {
        const copy = [...prev];
        copy[copy.length - 1] = {
          ...copy[copy.length - 1],
          content: result.text,
          reasoning: result.reasoning,
          toolCalls: result.toolCalls,
          streaming: false,
        };
        return copy;
      });
    } catch (err) {
      if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }

      const errMsg = err.name === 'AbortError' ? null : `⚠️ Gagal menghubungi server: ${err.message}`;
      setMessages((prev) => {
        const copy = [...prev];
        const last = { ...copy[copy.length - 1] };
        if (errMsg) last.content = errMsg;
        last.streaming = false;
        copy[copy.length - 1] = last;
        return copy;
      });
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
  }, [messages, saveHistory, scheduleUpdate]);

  const handleSubmit = useCallback((e) => {
    e.preventDefault();
    sendMessage(inputValueRef.current);
  }, [sendMessage]);

  const handleSuggestion = useCallback((text) => sendMessage(text), [sendMessage]);
  const handleStop = useCallback(() => abortRef.current?.abort(), []);
  const handleClear = useCallback(() => {
    if (confirm('Hapus semua percakapan?')) {
      setMessages([]);
      localStorage.removeItem(STORAGE_KEY);
    }
  }, []);
  const handleBack = useCallback(() => {
    setIsExiting(true);
    setTimeout(() => { window.location.href = '/'; }, 300);
  }, []);
  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(inputValueRef.current); }
  }, [sendMessage]);

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
            <button onClick={handleStop} className="text-[#ef4444] hover:bg-[#1a1b1f] transition-colors p-2 rounded-lg" title="Stop">
              <i className="fas fa-stop text-sm" />
            </button>
          )}
          {messages.length > 0 && (
            <button onClick={handleClear} className="text-[#52525b] hover:text-[#ef4444] transition-colors p-2 rounded-lg hover:bg-[#1a1b1f]" title="Clear chat">
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
            <p className="text-[#71717a] text-[13px] text-center max-w-md mb-8 leading-relaxed">
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
          <div className="max-w-4xl mx-auto py-6">
            {messages.map((msg) => (
              <MessageBubble key={msg.id} msg={msg} />
            ))}
          </div>
        )}
      </div>

      {/* ─── Input Bar ─── */}
      <div className="shrink-0 border-t border-[#1a1b1f] bg-[#09090b] p-3 md:p-4 z-30">
        <form onSubmit={handleSubmit} className="max-w-4xl mx-auto">
          <div className="relative bg-[#141517] rounded-2xl border border-[#1a1b1f] focus-within:border-[#a78bfa]/40 transition-colors">
            <textarea
              ref={inputRefEl}
              defaultValue=""
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              placeholder="Tanya apa saja..."
              rows={1}
              className="w-full bg-transparent text-white placeholder-[#52525b] text-[14px] px-5 py-3.5 pr-12 resize-none outline-none max-h-40 custom-scrollbar leading-relaxed"
              style={{ minHeight: '48px' }}
              disabled={loading}
            />
            <button
              type="submit"
              disabled={loading || !inputDraft.trim()}
              className={`absolute right-2.5 bottom-2.5 w-9 h-9 rounded-xl flex items-center justify-center transition-all ${
                inputDraft.trim() && !loading
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
            Puru AI menggunakan /api/puru-ai (ToolLoopAgent) dengan model auto
          </p>
        </form>
      </div>
    </div>
  );
}

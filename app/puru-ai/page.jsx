'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/* ═══════════════════════════════════════════════════════════════
   Puru AI — Chat with AI that can search web & know PuruBoy API
   ═══════════════════════════════════════════════════════════════ */

const API_URL = '/api/puru-ai';
const STORAGE_KEY = 'puru-ai-history';
const MAX_HISTORY = 50;

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
          ) : msg.content ? (
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

/* ══════════════════════ Main Page ══════════════════════ */

export default function PuruAIPage() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [isExiting, setIsExiting] = useState(false);
  const scrollRef = useRef(null);
  const inputRef = useRef(null);
  const abortRef = useRef(null);

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

  // Save history
  const saveHistory = useCallback((msgs) => {
    try {
      const toSave = msgs.filter((m) => m.role === 'user' || m.role === 'assistant').slice(-MAX_HISTORY * 2);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
    } catch { /* ignore */ }
  }, []);

  // Auto scroll
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const sendMessage = useCallback(async (text) => {
    if (!text.trim() || loading) return;
    const userMsg = { role: 'user', content: text.trim(), id: Date.now() };
    const assistantMsg = {
      role: 'assistant',
      content: '',
      id: Date.now() + 1,
      toolCalls: [],
      streaming: true,
      reasoning: null,
    };

    const updated = [...messages, userMsg, assistantMsg];
    setMessages(updated);
    setInput('');
    setLoading(true);

    // Build conversation for API (only user/assistant pairs, not internals)
    const apiMessages = [...messages, userMsg]
      .filter((m) => m.role === 'user' || (m.role === 'assistant' && m.content))
      .map((m) => ({ role: m.role, content: m.content }));

    try {
      abortRef.current = new AbortController();

      const res = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: apiMessages, model: 'auto' }),
        signal: abortRef.current.signal,
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      let currentText = '';
      let currentTools = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop();

        for (const line of lines) {
          if (!line.trim()) continue;
          let event;
          try {
            event = JSON.parse(line);
          } catch {
            continue;
          }

          switch (event.type) {
            case 'text':
              currentText += event.content;
              setMessages((prev) => {
                const last = { ...prev[prev.length - 1] };
                last.content = currentText;
                last.streaming = true;
                return [...prev.slice(0, -1), last];
              });
              break;

            case 'thinking':
              setMessages((prev) => {
                const last = { ...prev[prev.length - 1] };
                last.reasoning = event.content;
                return [...prev.slice(0, -1), last];
              });
              break;

            case 'tools_done':
              currentTools = event.tools || [];
              setMessages((prev) => {
                const last = { ...prev[prev.length - 1] };
                last.toolCalls = currentTools.map((t) => ({
                  ...t,
                  status: 'done',
                }));
                return [...prev.slice(0, -1), last];
              });
              break;

            case 'error':
              setMessages((prev) => {
                const last = { ...prev[prev.length - 1] };
                last.content = `⚠️ Error: ${event.message}`;
                last.streaming = false;
                return [...prev.slice(0, -1), last];
              });
              break;

            case 'done':
              setMessages((prev) => {
                const last = { ...prev[prev.length - 1] };
                last.streaming = false;
                last.model = event.model;
                return [...prev.slice(0, -1), last];
              });
              break;
          }
        }
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        setMessages((prev) => {
          const last = { ...prev[prev.length - 1] };
          last.content = `⚠️ Gagal menghubungi server: ${err.message}`;
          last.streaming = false;
          return [...prev.slice(0, -1), last];
        });
      }
    } finally {
      setMessages((prev) => {
        const last = { ...prev[prev.length - 1] };
        if (last) last.streaming = false;
        saveHistory(prev);
        return prev;
      });
      setLoading(false);
      abortRef.current = null;
    }
  }, [messages, loading, saveHistory]);

  const handleSubmit = (e) => {
    e.preventDefault();
    sendMessage(input);
  };

  const handleSuggestion = (text) => {
    sendMessage(text);
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

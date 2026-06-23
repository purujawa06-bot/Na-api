'use client';
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

const MAX_HISTORY = 20;
const TOKEN_LIMIT = 20000;
const SYNC_INTERVAL = 2000;

// Estimasi token: ~4 chars per token
const estimateTokens = (text) => Math.ceil((text?.length || 0) / 4);

const formatTime = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

export default function PuruAI() {
    const router = useRouter();
    const [messages, setMessages] = useState([]);
    const [input, setInput] = useState('');
    const [loading, setLoading] = useState(false);
    const [compacting, setCompacting] = useState(false);
    const [compactNotif, setCompactNotif] = useState(null);
    const [isExiting, setIsExiting] = useState(false);
    const [lastSyncVersion, setLastSyncVersion] = useState(0);
    const messagesEndRef = useRef(null);
    const inputRef = useRef(null);
    const storageKey = 'puruai_messages';
    const versionKey = 'puruai_version';
    const compactKey = 'puruai_compacted';

    // Generate version untuk tracking perubahan
    const getVersion = () => parseInt(localStorage.getItem(versionKey) || '0', 10);

    // Load dari localStorage
    const loadFromStorage = useCallback(() => {
        try {
            const saved = localStorage.getItem(storageKey);
            const currentVersion = getVersion();
            if (saved) {
                const parsed = JSON.parse(saved);
                if (Array.isArray(parsed)) {
                    setMessages(parsed);
                    setLastSyncVersion(currentVersion);
                    return true;
                }
            }
        } catch {}
        return false;
    }, []);

    // Initial load
    useEffect(() => {
        loadFromStorage();
        setTimeout(() => inputRef.current?.focus(), 300);
    }, [loadFromStorage]);

    // 🔁 Real-time sync: cek perubahan dari tab/system lain setiap 2 detik
    useEffect(() => {
        const interval = setInterval(() => {
            try {
                const currentVersion = getVersion();
                if (currentVersion !== lastSyncVersion) {
                    const saved = localStorage.getItem(storageKey);
                    if (saved) {
                        const parsed = JSON.parse(saved);
                        if (Array.isArray(parsed)) {
                            setMessages(parsed);
                            setLastSyncVersion(currentVersion);
                        }
                    }
                }
            } catch {}
        }, SYNC_INTERVAL);
        return () => clearInterval(interval);
    }, [lastSyncVersion]);

    // 💾 Save ke localStorage + update version
    const saveToStorage = useCallback((msgs) => {
        try {
            localStorage.setItem(storageKey, JSON.stringify(msgs));
            const newVer = Date.now();
            localStorage.setItem(versionKey, String(newVer));
            setLastSyncVersion(newVer);
        } catch {}
    }, []);

    // Auto-save saat messages berubah
    useEffect(() => {
        if (messages.length > 0) {
            saveToStorage(messages);
        }
    }, [messages, saveToStorage]);

    // Auto-scroll
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    // 🔢 Hitung total token
    const totalTokens = messages.reduce((sum, m) => sum + estimateTokens(m.content), 0);
    const isOverLimit = totalTokens > TOKEN_LIMIT;

    // 📦 Get context (last 20 exchanges)
    const getContext = () => {
        return messages.slice(-MAX_HISTORY).map(m => ({
            role: m.role,
            content: m.content
        }));
    };

    // 🧹 Auto-compact
    const autoCompact = async () => {
        if (compacting || messages.length < 4) return;
        setCompacting(true);
        setCompactNotif('🧹 Mengompres percakapan...');

        try {
            const res = await fetch('/api/ai/puruai/compact', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    messages: [{ role: 'user', content: `Ringkas percakapan berikut dalam bahasa Indonesia, tangkap topik utama dan poin penting:\n\n${messages.slice(0, -4).map(m => `${m.role === 'user' ? 'User' : 'AI'}: ${m.content}`).join('\n')}` }]
                }),
            });

            if (!res.ok) throw new Error('Compact gagal');

            const data = await res.json();
            const summary = data?.summary || 'Ringkasan tidak tersedia.';

            // Ambil 4 pesan terakhir
            const last4 = messages.slice(-4);

            // Buat compact state
            const compacted = [
                { role: 'system', content: `📋 **Ringkasan percakapan sebelumnya:**\n${summary}`, time: formatTime(), id: Date.now() - 1, isSummary: true },
                ...last4
            ];

            setMessages(compacted);
            saveToStorage(compacted);

            setCompactNotif(`✅ Percakapan di-ringkas! ${messages.length - 4} pesan lama dikompres.`);
            setTimeout(() => setCompactNotif(null), 4000);

        } catch (err) {
            setCompactNotif(`⚠️ Gagal kompres: ${err.message}`);
            setTimeout(() => setCompactNotif(null), 4000);
        } finally {
            setCompacting(false);
        }
    };

    // Auto-compact trigger saat over limit
    useEffect(() => {
        if (isOverLimit && !loading && !compacting && messages.length >= 6) {
            autoCompact();
        }
    }, [totalTokens, loading]);

    const sendMessage = async (e) => {
        e?.preventDefault();
        const text = input.trim();
        if (!text || loading) return;

        const userMsg = { role: 'user', content: text, time: formatTime(), id: Date.now() };
        const updated = [...messages, userMsg];
        setMessages(updated);
        setInput('');
        setLoading(true);

        const assistantMsg = { role: 'assistant', content: '', time: formatTime(), id: Date.now() + 1 };
        setMessages(prev => [...prev, assistantMsg]);

        if (document.activeElement?.blur) document.activeElement.blur();

        try {
            const context = [...getContext(), { role: 'user', content: text }];

            const res = await fetch('/api/ai/puruai', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ messages: context }),
            });

            if (!res.ok) {
                const err = await res.json().catch(() => ({ error: 'Unknown error' }));
                throw new Error(err.error || `HTTP ${res.status}`);
            }

            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';
            let fullContent = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        const data = line.slice(6).trim();
                        if (data === '[DONE]') continue;
                        try {
                            const parsed = JSON.parse(data);
                            if (parsed.error) throw new Error(parsed.error);
                            if (parsed.content) {
                                fullContent += parsed.content;
                                setMessages(prev => {
                                    const updated = [...prev];
                                    const last = updated[updated.length - 1];
                                    if (last && last.role === 'assistant' && last.id === assistantMsg.id) {
                                        last.content = fullContent;
                                    }
                                    return updated;
                                });
                            }
                        } catch {}
                    }
                }
            }

            if (fullContent) {
                setMessages(prev => {
                    const updated = [...prev];
                    const last = updated[updated.length - 1];
                    if (last && last.role === 'assistant' && last.id === assistantMsg.id) {
                        last.content = fullContent;
                    }
                    return updated;
                });
            }

        } catch (err) {
            setMessages(prev => {
                const updated = [...prev];
                const last = updated[updated.length - 1];
                if (last && last.role === 'assistant' && last.id === assistantMsg.id) {
                    last.content = `⚠️ Gagal: ${err.message}`;
                }
                return updated;
            });
        } finally {
            setLoading(false);
        }
    };

    const clearChat = () => {
        if (messages.length === 0 || confirm('Hapus semua percakapan?')) {
            setMessages([]);
            localStorage.removeItem(storageKey);
            localStorage.removeItem(versionKey);
            setCompactNotif(null);
        }
    };

    const handleBack = () => {
        setIsExiting(true);
        setTimeout(() => router.push('/'), 300);
    };

    const transitionClass = isExiting ? 'animate-slide-out-right' : 'animate-slide-in-right';
    const fullScreenStyle = "fixed inset-0 z-[100] bg-[#313338] flex flex-col h-dvh supports-[height:100dvh]:h-[100dvh]";

    // Markdown components
    const Code = ({ children, inline }) => {
        if (inline) {
            return <code className="bg-[#1e1f22] text-[#dcddde] px-1.5 py-0.5 rounded text-sm font-mono">{children}</code>;
        }
        return (
            <div className="relative group my-3">
                <div className="bg-[#1e1f22] rounded-lg overflow-x-auto">
                    <div className="flex items-center justify-between px-4 py-1.5 bg-[#2b2d31] border-b border-[#1e1f22]">
                        <span className="text-[10px] text-[#949ba4] font-mono uppercase tracking-wider">code</span>
                        <button onClick={() => navigator.clipboard.writeText(children)} className="text-[#949ba4] hover:text-white text-xs transition-colors">
                            <i className="fas fa-copy"></i>
                        </button>
                    </div>
                    <pre className="px-4 py-3 text-sm text-[#dcddde] overflow-x-auto">{children}</pre>
                </div>
            </div>
        );
    };

    const renderContent = (content) => {
        if (content.startsWith('⚠️')) {
            return <span className="text-red-400">{content}</span>;
        }
        return (
            <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                    code: Code,
                    p: ({ children }) => <p className="mb-2 last:mb-0 leading-relaxed">{children}</p>,
                    ul: ({ children }) => <ul className="list-disc ml-5 mb-2 space-y-1">{children}</ul>,
                    ol: ({ children }) => <ol className="list-decimal ml-5 mb-2 space-y-1">{children}</ol>,
                    li: ({ children }) => <li className="leading-relaxed">{children}</li>,
                    h1: ({ children }) => <h1 className="text-xl font-bold mb-2 mt-3">{children}</h1>,
                    h2: ({ children }) => <h2 className="text-lg font-bold mb-2 mt-3">{children}</h2>,
                    h3: ({ children }) => <h3 className="text-base font-bold mb-1 mt-2">{children}</h3>,
                    blockquote: ({ children }) => (
                        <blockquote className="border-l-4 border-[#5865f2] pl-3 italic text-[#b5bac1] my-2">{children}</blockquote>
                    ),
                    strong: ({ children }) => <strong className="font-bold text-white">{children}</strong>,
                    a: ({ href, children }) => (
                        <a href={href} target="_blank" rel="noopener noreferrer" className="text-[#5865f2] hover:underline">{children}</a>
                    ),
                    table: ({ children }) => (
                        <div className="overflow-x-auto my-3">
                            <table className="min-w-full border-collapse border border-[#1e1f22] text-sm">{children}</table>
                        </div>
                    ),
                    th: ({ children }) => <th className="border border-[#1e1f22] bg-[#2b2d31] px-3 py-2 text-left font-bold">{children}</th>,
                    td: ({ children }) => <td className="border border-[#1e1f22] px-3 py-2">{children}</td>,
                    hr: () => <hr className="border-[#1e1f22] my-4" />,
                }}
            >
                {content}
            </ReactMarkdown>
        );
    };

    const tokenPercent = Math.min(100, Math.round((totalTokens / TOKEN_LIMIT) * 100));
    const showTokenBar = totalTokens > 10000; // show after 10k

    return (
        <div className={`${fullScreenStyle} ${transitionClass}`}>
            {/* Header */}
            <div className="bg-[#2b2d31] h-14 border-b border-[#1e1f22] flex items-center px-4 justify-between z-30 shadow-sm shrink-0">
                <div className="flex items-center gap-3">
                    <button onClick={handleBack} className="text-[#b5bac1] hover:text-[#dbdee1] transition-colors p-2">
                        <i className="fas fa-arrow-left text-lg"></i>
                    </button>
                    <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-xl overflow-hidden shadow-lg border border-white/10 flex-shrink-0">
                            <Image src="/favicon.jpg" alt="PuruAI" width={32} height={32} className="w-full h-full object-cover" />
                        </div>
                        <div>
                            <h1 className="text-base font-bold text-[#f2f3f5]">PuruAI</h1>
                            <p className="text-[10px] text-[#949ba4] -mt-0.5">{loading ? 'Mengetik...' : compacting ? 'Mengompres...' : 'Online'}</p>
                        </div>
                    </div>
                </div>
                <div className="flex items-center gap-4 text-[#b5bac1]">
                    {/* Token indicator */}
                    <button
                        onClick={totalTokens > 10000 ? autoCompact : undefined}
                        title={`${totalTokens.toLocaleString()} / ${TOKEN_LIMIT.toLocaleString()} token`}
                        className={`text-xs font-mono transition-colors ${isOverLimit ? 'text-red-400 animate-pulse' : tokenPercent > 80 ? 'text-yellow-400' : 'text-[#949ba4]'}`}
                    >
                        <i className={`fas ${isOverLimit ? 'fa-exclamation-triangle' : 'fa-database'} mr-1`}></i>
                        {(totalTokens / 1000).toFixed(1)}k
                    </button>
                    <button onClick={clearChat} title="Hapus percakapan" className="hover:text-[#dbdee1] transition-colors">
                        <i className="fas fa-trash-alt"></i>
                    </button>
                </div>
            </div>

            {/* Token Progress Bar */}
            {showTokenBar && (
                <div className="h-1 bg-[#1e1f22] relative">
                    <div
                        className={`h-full transition-all duration-500 ${
                            isOverLimit ? 'bg-red-500' : tokenPercent > 80 ? 'bg-yellow-500' : 'bg-[#5865f2]'
                        }`}
                        style={{ width: `${tokenPercent}%` }}
                    ></div>
                </div>
            )}

            {/* Compact Notification */}
            {compactNotif && (
                <div className="bg-[#2b2d31] border-b border-[#1e1f22] px-4 py-2 flex items-center gap-2 text-xs text-[#b5bac1] animate-fade-in">
                    <span>{compactNotif}</span>
                    <button onClick={() => setCompactNotif(null)} className="ml-auto hover:text-white">
                        <i className="fas fa-times"></i>
                    </button>
                </div>
            )}

            {/* Chat Area */}
            <div className="flex-1 bg-[#313338] relative overflow-hidden">
                {messages.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full text-[#949ba4] p-8 text-center">
                        <div className="w-20 h-20 rounded-[2rem] bg-[#2b2d31] flex items-center justify-center mb-6 shadow-2xl overflow-hidden border border-white/10">
                            <Image src="/favicon.jpg" alt="PuruAI" width={80} height={80} className="w-full h-full object-cover" />
                        </div>
                        <h2 className="text-2xl font-bold text-[#f2f3f5] mb-3">PuruAI</h2>
                        <p className="text-sm text-[#b5bac1] mb-8 max-w-xs">
                            Asisten pintar dengan teknologi AI. Tanyakan apapun!
                        </p>
                        <div className="grid grid-cols-2 gap-3 w-full max-w-sm">
                            {['Cara kerja API ini?', 'Buatkan puisi lucu', 'Apa itu Next.js?', 'Cerita pendek lucu'].map((q, i) => (
                                <button
                                    key={i}
                                    onClick={() => setInput(q)}
                                    className="bg-[#2b2d31] hover:bg-[#383a40] text-[#b5bac1] text-xs p-3 rounded-xl border border-[#1e1f22] transition-all text-left leading-relaxed"
                                >
                                    {q}
                                </button>
                            ))}
                        </div>
                    </div>
                ) : (
                    <div className="h-full overflow-y-auto custom-scrollbar px-4 py-4 space-y-3">
                        {messages.map((msg, i) => {
                            const isUser = msg.role === 'user';
                            const isLastAssistant = msg.role === 'assistant' && i === messages.length - 1;
                            const isStreaming = isLastAssistant && loading && !msg.content;
                            const isSummary = msg.isSummary;

                            return (
                                <div key={msg.id || i}>
                                    {/* Summary separator */}
                                    {isSummary && (
                                        <div className="flex justify-center my-4">
                                            <span className="bg-purple-900/40 text-purple-300 text-[10px] font-bold px-3 py-1 rounded-full uppercase tracking-wider border border-purple-700/30">
                                                📋 Ringkasan
                                            </span>
                                        </div>
                                    )}

                                    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} items-end gap-2`}>
                                        {!isUser && (
                                            <div className="w-8 h-8 rounded-xl overflow-hidden shadow-lg border border-white/10 flex-shrink-0">
                                                <Image src="/favicon.jpg" alt="PuruAI" width={32} height={32} className="w-full h-full object-cover" />
                                            </div>
                                        )}

                                        <div className={`max-w-[80%] md:max-w-[65%] ${isUser ? 'order-1' : 'order-2'}`}>
                                            {isUser && (
                                                <div className="text-[11px] text-[#949ba4] text-right mb-1 font-medium">Kamu</div>
                                            )}

                                            <div className={`px-4 py-3 text-[15px] leading-relaxed break-words ${
                                                isUser
                                                    ? 'bg-[#5865f2] rounded-2xl rounded-tr-sm text-white'
                                                    : isSummary
                                                        ? 'bg-purple-900/20 rounded-2xl rounded-tl-sm text-[#c4b5fd] border border-purple-800/30'
                                                        : 'bg-[#2b2d31] rounded-2xl rounded-tl-sm text-[#dbdee1]'
                                            }`}>
                                                {isStreaming ? (
                                                    <span className="flex gap-1.5 py-1">
                                                        <span className="w-2 h-2 bg-[#949ba4] rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></span>
                                                        <span className="w-2 h-2 bg-[#949ba4] rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></span>
                                                        <span className="w-2 h-2 bg-[#949ba4] rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></span>
                                                    </span>
                                                ) : (
                                                    renderContent(msg.content)
                                                )}
                                            </div>

                                            <div className={`flex items-center gap-1 mt-1 ${isUser ? 'justify-end' : 'justify-start'}`}>
                                                <span className="text-[10px] text-[#949ba4]">{msg.time}</span>
                                                {isUser && <i className="fas fa-check-double text-[10px] text-[#949ba4]"></i>}
                                            </div>
                                        </div>

                                        {isUser && (
                                            <div className="w-8 h-8 rounded-xl overflow-hidden shadow-lg border border-white/10 flex-shrink-0">
                                                <Image src="/usericon.jpg" alt="Kamu" width={32} height={32} className="w-full h-full object-cover" />
                                            </div>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                        <div ref={messagesEndRef} />
                    </div>
                )}
            </div>

            {/* Input Area */}
            <div className="bg-[#313338] px-4 pb-5 pt-2 shrink-0 z-30">
                <form onSubmit={sendMessage} className="bg-[#383a40] rounded-lg flex items-center px-4 py-2.5 gap-3">
                    <input
                        ref={inputRef}
                        type="text"
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        placeholder="Tanya PuruAI..."
                        className="w-full bg-transparent border-none text-[#dbdee1] placeholder-[#949ba4] text-[15px] focus:ring-0 px-0 py-0 outline-none"
                        maxLength={2000}
                        disabled={loading || compacting}
                        autoFocus={false}
                    />
                    <button
                        type="submit"
                        disabled={loading || compacting || !input.trim()}
                        className={`transition-all ${!input.trim() || loading || compacting ? 'text-[#4f545c]' : 'text-[#5865f2] hover:text-white'}`}
                    >
                        <i className={`fas ${loading ? 'fa-spinner fa-spin' : 'fa-paper-plane'} text-lg`}></i>
                    </button>
                </form>

                {/* Token info */}
                <div className="flex items-center justify-between mt-1.5 px-1">
                    <p className="text-[10px] text-[#4f545c]">PuruAI dapat melakukan kesalahan. Selalu verifikasi informasi penting.</p>
                    {totalTokens > 5000 && (
                        <span className={`text-[9px] font-mono ${isOverLimit ? 'text-red-400' : 'text-[#4f545c]'}`}>
                            {totalTokens.toLocaleString()}/{TOKEN_LIMIT.toLocaleString()} token
                        </span>
                    )}
                </div>
            </div>
        </div>
    );
}

'use client';
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

const MAX_HISTORY = 20;
const TOKEN_LIMIT = 10000;
const COMPACT_TRIGGER = 10000;
const SYNC_INTERVAL = 2000;
const SAVE_DEBOUNCE = 800;

const estimateTokens = (text) => Math.ceil((text?.length || 0) / 4);
const formatTime = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

// ⚡️ Pure component untuk pesan biar gak re-render pas ngetik
const MessageBubble = React.memo(({ msg, isLast, loading }) => {
    const isUser = msg.role === 'user';
    const isStreaming = isLast && msg.role === 'assistant' && loading && !msg.content;
    const isSummary = msg.isSummary;

    const content = useMemo(() => {
        if (isStreaming) return null;
        if (msg.content.startsWith('⚠️')) {
            return <span className="text-red-400">{msg.content}</span>;
        }
        return (
            <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                    code: ({ children, inline }) => inline
                        ? <code className="bg-[#1e1f22] text-[#dcddde] px-1.5 py-0.5 rounded text-sm font-mono">{children}</code>
                        : (
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
                        ),
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
                {msg.content}
            </ReactMarkdown>
        );
    }, [msg.content, isStreaming]);

    return (
        <>
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
                    {isUser && <div className="text-[11px] text-[#949ba4] text-right mb-1 font-medium">Kamu</div>}
                    <div className={`px-4 py-3 text-[15px] leading-relaxed break-words ${
                        isUser ? 'bg-[#5865f2] rounded-2xl rounded-tr-sm text-white'
                        : isSummary ? 'bg-purple-900/20 rounded-2xl rounded-tl-sm text-[#c4b5fd] border border-purple-800/30'
                        : 'bg-[#2b2d31] rounded-2xl rounded-tl-sm text-[#dbdee1]'
                    }`}>
                        {isStreaming ? (
                            <span className="flex gap-1.5 py-1">
                                <span className="w-2 h-2 bg-[#949ba4] rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></span>
                                <span className="w-2 h-2 bg-[#949ba4] rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></span>
                                <span className="w-2 h-2 bg-[#949ba4] rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></span>
                            </span>
                        ) : content}
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
        </>
    );
});
MessageBubble.displayName = 'MessageBubble';

// ⚡️ Input component terpisah — gak kena cascade re-render dari messages
const ChatInput = React.memo(({ onSend, loading, compacting }) => {
    const [text, setText] = useState('');
    const inputRef = useRef(null);

    useEffect(() => {
        setTimeout(() => inputRef.current?.focus(), 300);
    }, []);

    const submit = (e) => {
        e?.preventDefault();
        const t = text.trim();
        if (!t || loading || compacting) return;
        onSend(t);
        setText('');
    };

    return (
        <form onSubmit={submit} className="bg-[#383a40] rounded-lg flex items-center px-4 py-2.5 gap-3">
            <input
                ref={inputRef}
                type="text"
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Tanya PuruAI..."
                className="w-full bg-transparent border-none text-[#dbdee1] placeholder-[#949ba4] text-[15px] focus:ring-0 px-0 py-0 outline-none"
                maxLength={2000}
                disabled={loading || compacting}
                autoFocus={false}
                autoComplete="off"
            />
            <button
                type="submit"
                disabled={loading || compacting || !text.trim()}
                className={`transition-all ${!text.trim() || loading || compacting ? 'text-[#4f545c]' : 'text-[#5865f2] hover:text-white'}`}
            >
                <i className={`fas ${loading ? 'fa-spinner fa-spin' : 'fa-paper-plane'} text-lg`}></i>
            </button>
        </form>
    );
});
ChatInput.displayName = 'ChatInput';

export default function PuruAI() {
    const router = useRouter();
    const [messages, setMessages] = useState([]);
    const [loading, setLoading] = useState(false);
    const [compacting, setCompacting] = useState(false);
    const [compactNotif, setCompactNotif] = useState(null);
    const [isExiting, setIsExiting] = useState(false);
    const [lastSyncVersion, setLastSyncVersion] = useState(0);
    const messagesEndRef = useRef(null);
    const saveTimerRef = useRef(null);

    const storageKey = 'puruai_messages';
    const versionKey = 'puruai_version';

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

    useEffect(() => { loadFromStorage(); }, [loadFromStorage]);

    // 🔁 Real-time sync
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

    // 💾 Debounce save ke localStorage (gak tiap render, cuma tiap 800ms setelah perubahan)
    useEffect(() => {
        if (messages.length === 0) return;
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
        saveTimerRef.current = setTimeout(() => {
            try {
                localStorage.setItem(storageKey, JSON.stringify(messages));
                localStorage.setItem(versionKey, String(Date.now()));
                setLastSyncVersion(Date.now());
            } catch {}
        }, SAVE_DEBOUNCE);
        return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); };
    }, [messages]);

    // Auto-scroll
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    // 🔢 Memoized token count — gak hitung ulang tiap ngetik
    const totalTokens = useMemo(() =>
        messages.reduce((sum, m) => sum + estimateTokens(m.content), 0),
        [messages]
    );
    const isOverLimit = totalTokens > COMPACT_TRIGGER;
    const tokenPercent = Math.min(100, Math.round((totalTokens / TOKEN_LIMIT) * 100));
    const showTokenBar = totalTokens > 5000;

    // 📦 Memoized context — kirim max 20 pesan terakhir
    const getContext = useCallback(() => {
        return messages.slice(-MAX_HISTORY).map(m => ({
            role: m.role === 'system' ? 'user' : m.role,
            content: m.isSummary ? `[Konteks Sebelumnya]: ${m.content}` : m.content
        }));
    }, [messages]);

    // 🧹 Auto-compact dengan context preservation
    const autoCompact = useCallback(async () => {
        if (compacting || messages.length < 4) return;
        setCompacting(true);
        setCompactNotif('🧹 Mengompres percakapan...');

        try {
            // Ambil semua pesan kecuali 4 terakhir untuk diringkas
            const toSummarize = messages.filter(m => !m.isSummary);
            const recentMessages = toSummarize.slice(-4);
            const oldMessages = toSummarize.slice(0, -4);
            
            if (oldMessages.length === 0) {
                setCompacting(false);
                return;
            }

            const conversationText = oldMessages
                .map(m => `${m.role === 'user' ? 'User' : 'AI'}: ${m.content}`)
                .join('\n');

            const res = await fetch('/api/ai/puruai/compact', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    messages: [{
                        role: 'user',
                        content: `Buat ringkasan kompresi percakapan ini. Fokus pada:
1. Topik utama yang dibahas
2. Pertanyaan user dan jawaban AI yang diberikan  
3. Preferensi atau konteks penting user
4. Kesimpulan atau hasil akhir

Jangan buang detail penting. Format dengan bullet point.

Percakapan:
${conversationText}`
                    }]
                }),
            });
            
            if (!res.ok) throw new Error('Compact gagal');
            const data = await res.json();
            const summary = data?.summary || 'Ringkasan tidak tersedia.';
            const prevSummary = messages.find(m => m.isSummary);
            
            // Gabung ringkasan lama + baru
            const fullSummary = prevSummary
                ? `${prevSummary.content}\n\n---\n\n${summary}`
                : summary;

            const compacted = [
                { 
                    role: 'system', 
                    content: `📋 **Ringkasan percakapan:**\n\n${fullSummary}`,
                    time: formatTime(), 
                    id: Date.now() - 1, 
                    isSummary: true 
                },
                ...recentMessages
            ];
            
            setMessages(compacted);
            const saved = oldMessages.length;
            setCompactNotif(`✅ Terkompres! ${saved} pesan lama diringkas.`);
            setTimeout(() => setCompactNotif(null), 4000);
        } catch (err) {
            setCompactNotif(`⚠️ Gagal kompres: ${err.message}`);
            setTimeout(() => setCompactNotif(null), 4000);
        } finally {
            setCompacting(false);
        }
    }, [messages, compacting]);

    // Auto-compact trigger — aktif di 10k token
    useEffect(() => {
        if (totalTokens >= COMPACT_TRIGGER && !loading && !compacting && messages.length >= 6) {
            autoCompact();
        }
    }, [totalTokens, loading]);

    // ⚡️ Client-side streaming buffer — smooth rendering dari token API
    const sendMessage = useCallback(async (text) => {
        const userMsg = { role: 'user', content: text, time: formatTime(), id: Date.now() };
        setMessages(prev => [...prev, userMsg]);
        setLoading(true);

        const assistantMsg = { role: 'assistant', content: '', time: formatTime(), id: Date.now() + 1 };
        setMessages(prev => [...prev, assistantMsg]);

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

            // 🔄 Streaming: kata per kata langsung saat data datang
            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';
            let fullContent = '';
            let displayContent = '';
            let wordCursor = 0; // posisi kata untuk delay timing

            // Baca stream dari API — langsung schedule render per kata
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
                                // Pecah per kata & langsung schedule render tanpa nunggu queue
                                const words = parsed.content.match(/\S+\s*/g) || [parsed.content];
                                for (const word of words) {
                                    const myPos = wordCursor++;
                                    const delay = myPos * 200;
                                    setTimeout(() => {
                                        displayContent += word;
                                        setMessages(prev => {
                                            const updated = [...prev];
                                            const last = updated[updated.length - 1];
                                            if (last && last.role === 'assistant' && last.id === assistantMsg.id) {
                                                last.content = displayContent;
                                            }
                                            return updated;
                                        });
                                    }, delay);
                                }
                            }
                        } catch {}
                    }
                }
            }

            // Final flush — pastikan full content pas dengan yang terakhir
            setTimeout(() => {
                setMessages(prev => {
                    const updated = [...prev];
                    const last = updated[updated.length - 1];
                    if (last && last.role === 'assistant' && last.id === assistantMsg.id) {
                        last.content = fullContent;
                    }
                    return updated;
                });
            }, wordCursor * 200 + 100);

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
    }, [getContext]);

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
                    <button
                        onClick={totalTokens > 5000 ? autoCompact : undefined}
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
                    <div className={`h-full transition-all duration-500 ${isOverLimit ? 'bg-red-500' : tokenPercent > 80 ? 'bg-yellow-500' : 'bg-[#5865f2]'}`} style={{ width: `${tokenPercent}%` }}></div>
                </div>
            )}

            {/* Compact Notification */}
            {compactNotif && (
                <div className="bg-[#2b2d31] border-b border-[#1e1f22] px-4 py-2 flex items-center gap-2 text-xs text-[#b5bac1] animate-fade-in">
                    <span>{compactNotif}</span>
                    <button onClick={() => setCompactNotif(null)} className="ml-auto hover:text-white"><i className="fas fa-times"></i></button>
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
                        <p className="text-sm text-[#b5bac1] mb-8 max-w-xs">Asisten pintar dengan teknologi AI. Tanyakan apapun!</p>
                        <div className="grid grid-cols-2 gap-3 w-full max-w-sm">
                            {['Cara kerja API ini?', 'Buatkan puisi lucu', 'Apa itu Next.js?', 'Cerita pendek lucu'].map((q, i) => (
                                <button key={i} onClick={() => { sendMessage(q) }} className="bg-[#2b2d31] hover:bg-[#383a40] text-[#b5bac1] text-xs p-3 rounded-xl border border-[#1e1f22] transition-all text-left leading-relaxed">{q}</button>
                            ))}
                        </div>
                    </div>
                ) : (
                    <div className="h-full overflow-y-auto custom-scrollbar px-4 py-4 space-y-3">
                        {messages.map((msg, i) => (
                            <MessageBubble
                                key={msg.id || i}
                                msg={msg}
                                isLast={i === messages.length - 1}
                                loading={loading}
                            />
                        ))}
                        <div ref={messagesEndRef} />
                    </div>
                )}
            </div>

            {/* Input Area */}
            <div className="bg-[#313338] px-4 pb-5 pt-2 shrink-0 z-30">
                <ChatInput onSend={sendMessage} loading={loading} compacting={compacting} />
                <div className="flex items-center justify-between mt-1.5 px-1">
                    <p className="text-[10px] text-[#4f545c]">PuruAI dapat melakukan kesalahan. Selalu verifikasi informasi penting.</p>
                    {totalTokens > 3000 && (
                        <span className={`text-[9px] font-mono ${isOverLimit ? 'text-red-400' : 'text-[#4f545c]'}`}>
                            {totalTokens.toLocaleString()}/{TOKEN_LIMIT.toLocaleString()} token
                        </span>
                    )}
                </div>
            </div>
        </div>
    );
}

'use client';
import React, { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';

const MAX_HISTORY = 20;

const formatTime = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

export default function PuruAI() {
    const router = useRouter();
    const [messages, setMessages] = useState([]);
    const [input, setInput] = useState('');
    const [loading, setLoading] = useState(false);
    const [isExiting, setIsExiting] = useState(false);
    const messagesEndRef = useRef(null);
    const inputRef = useRef(null);

    // Load history from localStorage
    useEffect(() => {
        try {
            const saved = localStorage.getItem('puruai_messages');
            if (saved) {
                const parsed = JSON.parse(saved);
                if (Array.isArray(parsed)) setMessages(parsed.slice(-MAX_HISTORY));
            }
        } catch {}
        setTimeout(() => inputRef.current?.focus(), 300);
    }, []);

    // Save to localStorage
    useEffect(() => {
        try {
            localStorage.setItem('puruai_messages', JSON.stringify(messages));
        } catch {}
    }, [messages]);

    // Auto-scroll
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    // Get context (last 20 exchanges)
    const getContext = () => {
        return messages.slice(-MAX_HISTORY).map(m => ({
            role: m.role,
            content: m.content
        }));
    };

    const sendMessage = async (e) => {
        e?.preventDefault();
        const text = input.trim();
        if (!text || loading) return;

        const userMsg = { role: 'user', content: text, time: formatTime(), id: Date.now() };
        setMessages(prev => [...prev, userMsg]);
        setInput('');
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

            // Read streaming response
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

            // Final update
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
            setTimeout(() => inputRef.current?.focus(), 100);
        }
    };

    const clearChat = () => {
        if (messages.length === 0 || confirm('Hapus semua percakapan?')) {
            setMessages([]);
            localStorage.removeItem('puruai_messages');
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
                        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-purple-500 to-purple-700 flex items-center justify-center shadow-lg">
                            <i className="fas fa-robot text-white text-sm"></i>
                        </div>
                        <div>
                            <h1 className="text-base font-bold text-[#f2f3f5]">PuruAI</h1>
                            <p className="text-[10px] text-[#949ba4] -mt-0.5">{loading ? 'Mengetik...' : 'Online'}</p>
                        </div>
                    </div>
                </div>
                <div className="flex gap-4 text-[#b5bac1]">
                    <button onClick={clearChat} title="Hapus percakapan" className="hover:text-[#dbdee1] transition-colors">
                        <i className="fas fa-trash-alt"></i>
                    </button>
                </div>
            </div>

            {/* Chat Area */}
            <div className="flex-1 bg-[#313338] relative overflow-hidden">
                {messages.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full text-[#949ba4] p-8 text-center">
                        <div className="w-20 h-20 rounded-[2rem] bg-gradient-to-br from-purple-600 to-indigo-700 flex items-center justify-center mb-6 shadow-2xl shadow-purple-900/40">
                            <i className="fas fa-robot text-4xl text-white"></i>
                        </div>
                        <h2 className="text-2xl font-bold text-[#f2f3f5] mb-3">PuruAI</h2>
                        <p className="text-sm text-[#b5bac1] mb-8 max-w-xs">
                            Asisten pintar dengan teknologi AI. Tanyakan apapun!
                        </p>
                        <div className="grid grid-cols-2 gap-3 w-full max-w-sm">
                            {['Cara kerja API ini?', 'Buatkan puisi lucu', 'Apa itu Next.js?', 'Cerita pendek lucu'].map((q, i) => (
                                <button
                                    key={i}
                                    onClick={() => {
                                        setInput(q);
                                        inputRef.current?.focus();
                                    }}
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
                            
                            return (
                                <div key={msg.id || i} className={`flex ${isUser ? 'justify-end' : 'justify-start'} items-end gap-2`}>
                                    {!isUser && (
                                        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-500 to-purple-700 flex items-center justify-center flex-shrink-0 shadow-lg shadow-purple-900/30">
                                            <i className="fas fa-robot text-white text-xs"></i>
                                        </div>
                                    )}
                                    
                                    <div className={`max-w-[80%] md:max-w-[65%] ${isUser ? 'order-1' : 'order-2'}`}>
                                        {isUser && (
                                            <div className="text-[11px] text-[#949ba4] text-right mb-1 font-medium">Kamu</div>
                                        )}
                                        
                                        <div className={`px-4 py-3 text-[15px] leading-relaxed break-words whitespace-pre-wrap ${
                                            isUser
                                                ? 'bg-[#5865f2] rounded-2xl rounded-tr-sm text-white'
                                                : 'bg-[#2b2d31] rounded-2xl rounded-tl-sm text-[#dbdee1]'
                                        }`}>
                                            {isStreaming ? (
                                                <span className="flex gap-1.5 py-1">
                                                    <span className="w-2 h-2 bg-[#949ba4] rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></span>
                                                    <span className="w-2 h-2 bg-[#949ba4] rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></span>
                                                    <span className="w-2 h-2 bg-[#949ba4] rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></span>
                                                </span>
                                            ) : (
                                                msg.content
                                            )}
                                        </div>
                                        
                                        <div className={`flex items-center gap-1 mt-1 ${isUser ? 'justify-end' : 'justify-start'}`}>
                                            <span className="text-[10px] text-[#949ba4]">{msg.time}</span>
                                            {isUser && <i className="fas fa-check-double text-[10px] text-[#949ba4]"></i>}
                                        </div>
                                    </div>
                                    
                                    {isUser && (
                                        <div className="w-8 h-8 rounded-full bg-[#5865f2] flex items-center justify-center flex-shrink-0 shadow-lg shadow-[#5865f2]/30">
                                            <i className="fas fa-user text-white text-xs"></i>
                                        </div>
                                    )}
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
                        disabled={loading}
                    />
                    <button
                        type="submit"
                        disabled={loading || !input.trim()}
                        className={`transition-all ${!input.trim() || loading ? 'text-[#4f545c]' : 'text-[#5865f2] hover:text-white'}`}
                    >
                        <i className={`fas ${loading ? 'fa-spinner fa-spin' : 'fa-paper-plane'} text-lg`}></i>
                    </button>
                </form>
                <p className="text-[10px] text-[#4f545c] text-center mt-2">
                    PuruAI dapat melakukan kesalahan. Selalu verifikasi informasi penting.
                </p>
            </div>
        </div>
    );
}

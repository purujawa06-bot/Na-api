'use client';

import React, { useState, useEffect, useRef, memo, useCallback } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import CryptoJS from 'crypto-js';
import { v4 as uuidv4 } from 'uuid';
import { Virtuoso } from 'react-virtuoso';

// --- INDEXED DB HELPERS ---
const DB_NAME = 'PuruBoyChatDB';
const STORE_NAME = 'chats';
const DB_VERSION = 1;

const initDB = () => new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
            db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        }
    };
    request.onsuccess = (e) => resolve(e.target.result);
    request.onerror = (e) => reject(e.target.error);
});

const getStoredChats = async () => {
    try {
        const db = await initDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readonly');
            const req = tx.objectStore(STORE_NAME).getAll();
            req.onsuccess = () => {
                const res = req.result.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
                resolve(res.slice(-500));
            };
            req.onerror = () => reject(req.error);
        });
    } catch { return []; }
};

const storeChats = async (newChats) => {
    try {
        const db = await initDB();
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        newChats.forEach(chat => store.put(chat));
    } catch (e) { console.error("IDB Store Error", e); }
};

// --- HELPER FUNCTIONS ---
const getAvatarColor = (name) => {
    const colors = [
        'bg-red-500', 'bg-orange-500', 'bg-amber-500', 'bg-green-500', 'bg-emerald-500',
        'bg-teal-500', 'bg-cyan-500', 'bg-sky-500', 'bg-blue-500', 'bg-indigo-500',
        'bg-violet-500', 'bg-purple-500', 'bg-fuchsia-500', 'bg-pink-500', 'bg-rose-500'
    ];
    let hash = 0;
    for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
    return colors[Math.abs(hash) % colors.length];
};

const getInitials = (name) => {
    return name ? name.substring(0, 2).toUpperCase() : '?';
};

const formatTime = (dateString) => {
    return new Date(dateString).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
};

const getRelativeDateLabel = (dateString) => {
    const date = new Date(dateString);
    const now = new Date();
    const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const n = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const diffTime = n - d;
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    return date.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
};

// --- MEMOIZED COMPONENTS ---
const ChatBubble = memo(({ chat, username, prevChat, index }) => {
    const isMe = chat.username === username;
    const isSequence = prevChat && prevChat.username === chat.username;
    const showHeader = !isSequence;
    
    // Check if message is sticker
    const isSticker = chat.message.startsWith('[sticker:') && chat.message.endsWith(']');
    const stickerUrl = isSticker ? chat.message.slice(9, -1) : null;
    
    // Date Label
    const currentDateLabel = getRelativeDateLabel(chat.created_at);
    let showDateLabel = false;
    if (index === 0) {
        showDateLabel = true;
    } else if (prevChat) {
        const prevDateLabel = getRelativeDateLabel(prevChat.created_at);
        if (currentDateLabel !== prevDateLabel) showDateLabel = true;
    }

    return (
        <div className="w-full px-4 py-0.5">
            {showDateLabel && (
                <div className="flex justify-center my-6">
                    <span className="bg-[#1e1f22] text-[#949ba4] text-[11px] font-bold px-4 py-1 rounded-full uppercase tracking-wider">
                        {currentDateLabel}
                    </span>
                </div>
            )}
            
            <div className={`flex ${isMe ? 'justify-end' : 'justify-start'} group ${isSequence ? 'mt-0.5' : 'mt-4'}`}>
                {/* Avatar for Others (Left) */}
                {!isMe && (
                    <div className={`flex-shrink-0 w-9 h-9 mr-3 flex items-end ${isSequence ? 'invisible' : ''}`}>
                        <div className={`w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold text-white shadow-md ${getAvatarColor(chat.username)}`}>
                            {getInitials(chat.username)}
                        </div>
                    </div>
                )}

                <div className={`relative max-w-[80%] md:max-w-[60%] min-w-[100px] shadow-sm ${isSticker ? 'bg-transparent shadow-none' : ''}`}>
                    
                    {/* Header Name for Others */}
                    {!isMe && !isSequence && (
                        <div className="flex items-center gap-2 mb-1 ml-1">
                            <span className="text-[13px] font-bold text-[#f2f3f5]">{chat.username}</span>
                            <span className="text-[10px] text-[#949ba4]">{formatTime(chat.created_at)}</span>
                        </div>
                    )}

                    {/* Message Bubble or Sticker */}
                    {isSticker ? (
                        <div className="py-1 relative w-28 h-28 md:w-32 md:h-32">
                            <Image 
                                src={stickerUrl} 
                                alt="Sticker" 
                                fill
                                className="object-contain hover:scale-105 transition-transform duration-200"
                                sizes="(max-width: 768px) 112px, 128px"
                                unoptimized={true} // Handle dynamic sticker paths
                            />
                        </div>
                    ) : (
                        <div className={`
                            px-4 py-2.5 text-[15px] leading-relaxed break-words text-white
                            ${isMe 
                                ? 'bg-[#5865f2] rounded-2xl rounded-tr-sm' 
                                : 'bg-[#2b2d31] rounded-2xl rounded-tl-sm'
                            }
                            ${isSequence ? (isMe ? 'rounded-tr-2xl' : 'rounded-tl-2xl') : ''}
                        `}>
                            {chat.message}
                        </div>
                    )}
                    
                    {/* Timestamp for Me */}
                    {isMe && (
                         <div className="text-[10px] text-[#949ba4] text-right mt-1 pr-1 opacity-70">
                            {formatTime(chat.created_at)}
                            {isMe && <i className="fas fa-check ml-1"></i>}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
});

ChatBubble.displayName = 'ChatBubble';

const SECRET_KEY = 'PuruBoyChatSecureKey2025';

export default function ChatPage() {
    const router = useRouter();
    const [username, setUsername] = useState('');
    const [tempUsername, setTempUsername] = useState('');
    const [isLoggedIn, setIsLoggedIn] = useState(false);
    
    const [chats, setChats] = useState([]);
    const [inputMsg, setInputMsg] = useState('');
    const [sending, setSending] = useState(false);
    const [deviceId, setDeviceId] = useState('');
    const [showStickers, setShowStickers] = useState(false);
    const [isExiting, setIsExiting] = useState(false);
    
    // Automatic Sticker List
    const [stickerList, setStickerList] = useState([]);
    
    const chatsRef = useRef(chats); 
    const virtuosoRef = useRef(null);
    const stickerRef = useRef(null);

    useEffect(() => { chatsRef.current = chats; }, [chats]);

    useEffect(() => {
        const storedUser = localStorage.getItem('puruboy-chat-username');
        if (storedUser) {
            setUsername(storedUser);
            setIsLoggedIn(true);
        }

        let did = localStorage.getItem('puruboy-device-id');
        if (!did) {
            did = uuidv4();
            localStorage.setItem('puruboy-device-id', did);
        }
        setDeviceId(did);

        // Fetch Stickers Automatically
        fetch('/api/stickers')
            .then(res => res.json())
            .then(data => {
                if(Array.isArray(data) && data.length > 0) {
                    setStickerList(data);
                } else {
                    // Fallback manual if API empty
                    setStickerList(Array.from({length: 15}, (_, i) => `${i+1}.jpg`));
                }
            })
            .catch(() => {
                setStickerList(Array.from({length: 15}, (_, i) => `${i+1}.jpg`));
            });

    }, []);

    useEffect(() => {
        if (!isLoggedIn) return;

        const loadLocal = async () => {
            const localChats = await getStoredChats();
            if (localChats.length > 0) setChats(localChats);
            fetchChats(localChats);
        };
        loadLocal();

        const intervalId = setInterval(async () => {
            if (!document.hidden) {
                try {
                    const currentChats = chatsRef.current;
                    const lastChat = currentChats.length > 0 ? currentChats[currentChats.length - 1] : null;
                    const lastDate = lastChat ? lastChat.created_at : '';
                    
                    const pollRes = await fetch(`/api/chat?mode=poll&lastDate=${encodeURIComponent(lastDate)}`);
                    
                    if (pollRes.ok) {
                        const status = await pollRes.json();
                        if (!status.isLatest) {
                            fetchChats(currentChats);
                        }
                    }
                } catch (e) {
                    console.error("Poll Error:", e);
                }
            }
        }, 3000); 

        // Close sticker picker on click outside
        const handleClickOutside = (event) => {
            if (stickerRef.current && !stickerRef.current.contains(event.target)) {
                setShowStickers(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);

        return () => {
            clearInterval(intervalId);
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [isLoggedIn]);

    const fetchChats = async (currentChats = []) => {
        try {
            const lastChat = currentChats.length > 0 ? currentChats[currentChats.length - 1] : null;
            const lastTimestamp = lastChat ? lastChat.created_at : null;
            
            let url = '/api/chat';
            if (lastTimestamp) {
                url += `?after=${encodeURIComponent(lastTimestamp)}`;
            }

            const res = await fetch(url);
            if (res.ok) {
                const newChats = await res.json();
                if (newChats.length > 0) {
                    await storeChats(newChats);
                    setChats(prev => {
                        const ids = new Set(prev.map(c => c.id));
                        const uniqueNew = newChats.filter(c => !ids.has(c.id));
                        const merged = uniqueNew.length === 0 ? prev : [...prev, ...uniqueNew];
                        return merged.length > 500 ? merged.slice(-500) : merged;
                    });
                }
            }
        } catch (e) {
            console.error("Fetch chats error", e);
        }
    };

    const handleLogin = (e) => {
        e.preventDefault();
        if (!tempUsername.trim()) return;
        const cleanName = tempUsername.trim().substring(0, 15);
        localStorage.setItem('puruboy-chat-username', cleanName);
        setUsername(cleanName);
        setIsLoggedIn(true);
    };

    const sendMessageToApi = async (messageContent) => {
        if (sending) return;
        setSending(true);

        try {
            const timestamp = Date.now().toString();
            const signature = CryptoJS.SHA256(deviceId + SECRET_KEY + timestamp).toString();

            const res = await fetch('/api/chat', {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'x-device-id': deviceId,
                    'x-timestamp': timestamp,
                    'x-signature': signature
                },
                body: JSON.stringify({ username, message: messageContent })
            });
            
            if (res.ok) {
                fetchChats(chatsRef.current);
                virtuosoRef.current?.scrollToIndex({ index: chats.length, align: 'end', behavior: 'smooth' });
            } else {
                if (res.status === 429) {
                    alert('Slow down! 2 seconds cooldown.');
                } else {
                    alert('Failed to send message.');
                }
            }
        } catch (e) {
            console.error("Send error", e);
        } finally {
            setSending(false);
        }
    };

    const handleSend = async (e) => {
        e.preventDefault();
        if (!inputMsg.trim()) return;
        const msgToSend = inputMsg.trim();
        setInputMsg(''); 
        await sendMessageToApi(msgToSend);
    };

    const handleSendSticker = async (filename) => {
        setShowStickers(false);
        const msg = `[sticker:/sticker/${filename}]`;
        await sendMessageToApi(msg);
    };

    const handleLogout = () => {
        if(confirm("Logout from community?")) {
            localStorage.removeItem('puruboy-chat-username');
            setIsLoggedIn(false);
            setUsername('');
        }
    };

    const handleBack = () => {
        setIsExiting(true);
        // Delay to allow slide-out animation to play
        setTimeout(() => {
            router.push('/');
        }, 300);
    };

    const renderChatBubble = useCallback((index, chat) => {
        return (
            <ChatBubble 
                key={chat.id || index}
                chat={chat} 
                username={username}
                prevChat={chats[index - 1]}
                index={index}
            />
        );
    }, [username, chats]);

    // Animation Classes
    const transitionClass = isExiting ? 'animate-slide-out-right' : 'animate-slide-in-right';

    // Menggunakan fixed inset-0 dengan h-dvh untuk mengatasi masalah address bar di mobile browser
    // h-dvh (Dynamic Viewport Height) menyesuaikan dengan UI browser yang muncul/hilang
    const fullScreenStyle = "fixed inset-0 z-[100] bg-[#313338] flex flex-col h-dvh supports-[height:100dvh]:h-[100dvh]";

    if (!isLoggedIn) {
        return (
            <div className={`${fullScreenStyle} items-center justify-center p-4 animate-fade-in`}>
                <div className="absolute top-4 left-4 z-50">
                    <Link href="/" className="w-10 h-10 bg-[#2b2d31] rounded-full flex items-center justify-center text-[#dbdee1] hover:text-white transition-colors">
                        <i className="fas fa-arrow-left"></i>
                    </Link>
                </div>

                <div className="bg-[#2b2d31] p-8 w-full max-w-sm rounded-lg shadow-2xl text-center">
                    <div className="w-20 h-20 bg-[#5865f2] rounded-[2rem] mx-auto flex items-center justify-center mb-6 shadow-lg">
                        <i className="fab fa-discord text-4xl text-white"></i>
                    </div>
                    
                    <h1 className="text-2xl font-bold text-[#f2f3f5] mb-2">Welcome Back!</h1>
                    <p className="text-[#b5bac1] text-sm mb-8">
                        Join the Tiyanz Community chat.
                    </p>
                    
                    <form onSubmit={handleLogin} className="space-y-4 text-left">
                        <div>
                            <label className="text-xs font-bold text-[#b5bac1] uppercase mb-2 block">Username</label>
                            <input 
                                type="text" 
                                className="w-full bg-[#1e1f22] border-none rounded-md px-3 py-2.5 text-[#dbdee1] focus:outline-none focus:ring-2 focus:ring-[#5865f2] transition-all"
                                value={tempUsername}
                                onChange={(e) => setTempUsername(e.target.value)}
                                maxLength={15}
                                required
                            />
                        </div>
                        <button 
                            type="submit" 
                            className="w-full bg-[#5865f2] hover:bg-[#4752c4] text-white font-bold py-3 rounded-md transition-colors"
                        >
                            Log In
                        </button>
                    </form>
                </div>
            </div>
        );
    }

    return (
        <div className={`${fullScreenStyle} ${transitionClass}`}>
            {/* Header - Discord Style */}
            <div className="bg-[#2b2d31] h-14 border-b border-[#1e1f22] flex items-center px-4 justify-between z-30 shadow-sm shrink-0">
                <div className="flex items-center gap-3">
                    {/* Updated Back Button */}
                    <button onClick={handleBack} className="text-[#b5bac1] hover:text-[#dbdee1] transition-colors p-2">
                        <i className="fas fa-arrow-left text-lg"></i>
                    </button>
                    <div className="flex items-center gap-2">
                        <i className="fas fa-hashtag text-[#949ba4]"></i>
                        <h1 className="text-base font-bold text-[#f2f3f5]">general</h1>
                    </div>
                </div>
                <div className="flex gap-4 text-[#b5bac1]">
                    <button onClick={handleLogout} title="Logout" className="hover:text-[#dbdee1]">
                        <i className="fas fa-sign-out-alt"></i>
                    </button>
                </div>
            </div>

            {/* Chat Area - Solid Dark BG */}
            <div className="flex-1 bg-[#313338] relative overflow-hidden">
                {chats.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full text-[#949ba4] p-8 text-center">
                        <div className="w-16 h-16 bg-[#2b2d31] rounded-full flex items-center justify-center mb-4">
                            <i className="fas fa-hashtag text-2xl text-[#5865f2]"></i>
                        </div>
                        <h2 className="text-xl font-bold text-[#f2f3f5] mb-2">Welcome to #general</h2>
                        <p className="text-sm">This is the start of the Tiyanz Community server.</p>
                    </div>
                ) : (
                    <Virtuoso
                        ref={virtuosoRef}
                        style={{ height: '100%', overflowX: 'hidden' }}
                        data={chats}
                        initialTopMostItemIndex={chats.length - 1}
                        followOutput="auto"
                        alignToBottom
                        itemContent={renderChatBubble}
                    />
                )}
            </div>

            {/* Input Area - Discord Style */}
            <div className="bg-[#313338] px-4 pb-4 pt-2 shrink-0 z-30 relative">
                
                {/* Sticker Picker */}
                {showStickers && (
                    <div ref={stickerRef} className="absolute bottom-16 left-4 bg-[#2b2d31] border border-[#1e1f22] rounded-lg p-2 w-72 shadow-2xl z-40 animate-fade-in">
                        <div className="grid grid-cols-4 gap-2 h-56 overflow-y-auto custom-scrollbar">
                            {stickerList.map(filename => (
                                <button 
                                    key={filename} 
                                    onClick={() => handleSendSticker(filename)} 
                                    className="hover:bg-[#383a40] p-1 rounded transition-colors flex items-center justify-center relative h-20"
                                >
                                    <Image 
                                        src={`/sticker/${filename}`} 
                                        alt={`Sticker ${filename}`} 
                                        fill
                                        className="object-contain"
                                        sizes="80px"
                                        unoptimized={true}
                                    />
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                <div className="bg-[#383a40] rounded-lg flex items-center px-4 py-2.5 gap-3">
                    {/* Sticker Button */}
                    <button 
                        onClick={() => setShowStickers(!showStickers)} 
                        className={`flex-shrink-0 transition-colors ${showStickers ? 'text-[#e0e1e5]' : 'text-[#b5bac1] hover:text-[#dbdee1]'}`}
                    >
                        <i className={`fas ${showStickers ? 'fa-times-circle' : 'fa-smile'} text-lg`}></i>
                    </button>
                    
                    <input 
                        type="text" 
                        value={inputMsg}
                        onChange={(e) => setInputMsg(e.target.value)}
                        placeholder={`Message #${username}`}
                        className="w-full bg-transparent border-none text-[#dbdee1] placeholder-[#949ba4] text-[15px] focus:ring-0 px-0 py-0 outline-none"
                        maxLength={1000}
                        onKeyDown={(e) => e.key === 'Enter' && handleSend(e)}
                    />
                    <button 
                        onClick={handleSend}
                        disabled={sending || !inputMsg.trim()}
                        className={`transition-colors ${!inputMsg.trim() ? 'text-[#4f545c]' : 'text-[#5865f2] hover:text-white'}`}
                    >
                        <i className="fas fa-paper-plane text-lg"></i>
                    </button>
                </div>
            </div>
        </div>
    );
}
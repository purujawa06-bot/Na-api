'use client';

import React, { useState, useEffect } from 'react';

export default function ErrorReportPopup() {
    const [isVisible, setIsVisible] = useState(false);

    useEffect(() => {
        // Cek apakah user sudah pernah dismiss popup ini
        const dismissed = localStorage.getItem('dismissed_error_report');
        if (!dismissed) {
            // Munculkan setelah delay biar ga langsung kaget
            const timer = setTimeout(() => {
                setIsVisible(true);
                document.body.style.overflow = 'hidden';
            }, 1500);
            return () => {
                clearTimeout(timer);
                document.body.style.overflow = 'auto';
            };
        }
    }, []);

    const handleDismiss = () => {
        setIsVisible(false);
        document.body.style.overflow = 'auto';
        localStorage.setItem('dismissed_error_report', 'true');
    };

    if (!isVisible) return null;

    return (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in p-4">
            <div className="native-card max-w-sm w-full p-6 animate-slide-up relative border-red-500/30 shadow-[0_0_30px_rgba(239,68,68,0.15)]">
                {/* Tombol Close */}
                <button 
                    onClick={handleDismiss}
                    className="absolute top-4 right-4 w-8 h-8 flex items-center justify-center rounded-full bg-gray-800 text-gray-400 hover:text-white transition-colors"
                >
                    <i className="fas fa-times"></i>
                </button>

                {/* Logo Favicon */}
                <div className="flex justify-center mb-4">
                    <div className="w-16 h-16 rounded-2xl overflow-hidden shadow-lg border-2 border-red-500/20 ring-2 ring-red-500/10">
                        <img 
                            src="/favicon.jpg" 
                            alt="PuruBoy API" 
                            className="w-full h-full object-cover"
                        />
                    </div>
                </div>

                {/* Icon Peringatan */}
                <div className="flex justify-center -mt-2 mb-3">
                    <div className="bg-red-500/10 text-red-400 text-[10px] font-bold px-3 py-1 rounded-full border border-red-500/20 uppercase tracking-wider flex items-center gap-1">
                        <i className="fas fa-exclamation-triangle text-xs"></i> Perhatian
                    </div>
                </div>

                {/* Pesan */}
                <h2 className="text-lg font-bold text-white text-center mb-3">
                    Laporkan Error
                </h2>
                <p className="text-sm text-gray-400 text-center leading-relaxed mb-6">
                    Jika menemukan <span className="text-red-400 font-semibold">error</span> atau kendala saat menggunakan website ini, 
                    segera laporkan ke Telegram ya!
                </p>

                {/* Tombol Report */}
                <div className="flex flex-col gap-3">
                    <a 
                        href="https://t.me/puruupuruu" 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="w-full bg-[#24A1DE] hover:bg-[#1b8abf] text-white font-bold py-3 rounded-xl transition-all active:scale-95 flex items-center justify-center gap-2 shadow-lg shadow-blue-900/20"
                    >
                        <i className="fab fa-telegram text-lg"></i>
                        <span>Report ke @puruupuruu</span>
                    </a>
                    <button 
                        onClick={handleDismiss}
                        className="w-full py-2.5 text-sm font-bold text-gray-400 bg-gray-800 hover:bg-gray-700 rounded-xl transition-colors"
                    >
                        Nanti Saja
                    </button>
                </div>
            </div>
        </div>
    );
}

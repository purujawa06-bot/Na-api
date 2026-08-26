'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';

const STORAGE_KEY = 'support_popup_shown_at';
const EXPIRY_MS = 23 * 60 * 60 * 1000; // 23 jam

export default function SupportMePopup() {
    const [isVisible, setIsVisible] = useState(false);

    useEffect(() => {
        const shownAt = Number(localStorage.getItem(STORAGE_KEY));
        const expired = !shownAt || Date.now() - shownAt > EXPIRY_MS;
        if (expired) {
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
        localStorage.setItem(STORAGE_KEY, Date.now().toString());
    };

    if (!isVisible) return null;

    return (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in p-4">
            <div className="native-card max-w-sm w-full p-6 animate-slide-up relative border-pink-500/30 shadow-[0_0_30px_rgba(236,72,153,0.15)]">
                {/* Tombol Close */}
                <button 
                    onClick={handleDismiss}
                    className="absolute top-4 right-4 w-8 h-8 flex items-center justify-center rounded-full bg-gray-800 text-gray-400 hover:text-white transition-colors"
                >
                    <i className="fas fa-times"></i>
                </button>

                {/* Logo Favicon */}
                <div className="flex justify-center mb-4">
                    <div className="w-16 h-16 rounded-2xl overflow-hidden shadow-lg border-2 border-pink-500/20 ring-2 ring-pink-500/10">
                        <img 
                            src="/favicon.jpg" 
                            alt="PuruBoy API" 
                            className="w-full h-full object-cover"
                        />
                    </div>
                </div>

                {/* Icon Support */}
                <div className="flex justify-center -mt-2 mb-3">
                    <div className="bg-pink-500/10 text-pink-400 text-[10px] font-bold px-3 py-1 rounded-full border border-pink-500/20 uppercase tracking-wider flex items-center gap-1">
                        <i className="fas fa-heart text-xs"></i> Dukungan
                    </div>
                </div>

                {/* Pesan */}
                <h2 className="text-lg font-bold text-white text-center mb-3">
                    Support Me!
                </h2>
                <p className="text-sm text-gray-400 text-center leading-relaxed mb-6">
                    Website ini gratis selamanya. Jika merasa terbantu, 
                    <span className="text-pink-400 font-semibold"> dukung developer</span> agar semangat terus berkarya ya!
                </p>

                {/* Tombol Support */}
                <div className="flex flex-col gap-3">
                    <Link 
                        href="/support"
                        onClick={handleDismiss}
                        className="w-full bg-gradient-to-r from-pink-500 to-rose-500 hover:from-pink-600 hover:to-rose-600 text-white font-bold py-3 rounded-xl transition-all active:scale-95 flex items-center justify-center gap-2 shadow-lg shadow-pink-900/20"
                    >
                        <i className="fas fa-hand-holding-heart text-lg"></i>
                        <span>Dukung Sekarang</span>
                    </Link>
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

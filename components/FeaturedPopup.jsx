'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { apiUrl } from '../lib/apiBase';

export default function FeaturedPopup() {
    const [featured, setFeatured] = useState(null);
    const [isVisible, setIsVisible] = useState(false);
    const router = useRouter();

    useEffect(() => {
        const fetchFeatured = async () => {
            try {
                const res = await fetch(apiUrl('/api/admin/featured'));
                if (res.ok) {
                    const data = await res.json();
                    if (data && data.active && data.path) {
                        const identifier = `${data.path}:${data.version || '1.0.0'}`;
                        const dismissed = localStorage.getItem('dismissed_featured');
                        
                        if (dismissed !== identifier) {
                            setFeatured({ ...data, identifier });
                            setIsVisible(true);
                            document.body.style.overflow = 'hidden';
                        }
                    }
                }
            } catch (e) {
                console.error("Failed to fetch featured endpoint", e);
            }
        };
        
        fetchFeatured();

        return () => {
            document.body.style.overflow = 'auto';
        };
    }, []);

    const handleDismiss = () => {
        setIsVisible(false);
        document.body.style.overflow = 'auto';
        if (featured) {
            localStorage.setItem('dismissed_featured', featured.identifier);
        }
    };

    const handleGo = () => {
        handleDismiss();
        if (featured.path.startsWith('/api/')) {
            router.push(`/docs?endpoint=${encodeURIComponent(featured.path)}`);
        } else {
            router.push(featured.path);
        }
    };

    if (!isVisible || !featured) return null;

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in p-4">
            <div className="native-card max-w-sm w-full p-6 animate-slide-up relative border-accent/50 shadow-[0_0_30px_rgba(236,72,153,0.2)]">
                <button 
                    onClick={handleDismiss}
                    className="absolute top-4 right-4 w-8 h-8 flex items-center justify-center rounded-full bg-gray-800 text-gray-400 hover:text-white transition-colors"
                >
                    <i className="fas fa-times"></i>
                </button>
                
                <div className="w-14 h-14 bg-gradient-to-br from-pink-500 to-purple-600 rounded-2xl flex items-center justify-center mb-4 shadow-lg shadow-pink-500/30">
                    <i className="fas fa-bolt text-white text-2xl animate-pulse"></i>
                </div>
                
                <h2 className="text-xl font-bold text-white mb-2">{featured.title || 'Fitur Baru!'}</h2>
                <p className="text-sm text-gray-400 mb-6 leading-relaxed">
                    {featured.description || 'Ada pembaruan atau fitur baru yang bisa kamu coba sekarang.'}
                </p>
                
                <div className="flex gap-3">
                    <button 
                        onClick={handleDismiss}
                        className="flex-1 py-3 text-sm font-bold text-gray-400 bg-gray-800 hover:bg-gray-700 rounded-xl transition-colors"
                    >
                        Nanti Saja
                    </button>
                    <button 
                        onClick={handleGo}
                        className="flex-1 py-3 text-sm font-bold text-white bg-accent hover:bg-accent-hover rounded-xl shadow-lg shadow-accent/20 transition-transform active:scale-95"
                    >
                        Gas Cobain!
                    </button>
                </div>
            </div>
        </div>
    );
}
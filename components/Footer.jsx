'use client';

import React from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export default function Footer() {
    const pathname = usePathname();

    // Sembunyikan footer di halaman chat dan docs
    if (pathname === '/chat' || pathname.startsWith('/docs')) return null;

    return (
        <footer className="mt-12 border-t border-default pt-8 pb-28 px-4">
            {/* Banner PurTV Premium Cinematic */}
            <div className="native-card p-0 mb-8 relative overflow-hidden group border border-purple-500/20 rounded-3xl shadow-2xl shadow-purple-900/30 bg-black">
                {/* Cinematic Backdrop */}
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,_var(--tw-gradient-stops))] from-purple-600/30 via-blue-900/40 to-black opacity-100"></div>
                <div className="absolute inset-0 bg-gradient-to-r from-black via-transparent to-transparent opacity-90"></div>
                
                {/* Animated Atmosphere */}
                <div className="absolute -top-[100%] -left-[100%] w-[300%] h-[300%] bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-purple-500/10 via-transparent to-transparent animate-slow-spin opacity-40"></div>

                <div className="relative z-10 flex flex-col lg:flex-row items-center gap-8 p-8 md:p-10">
                    
                    {/* Glowing Logo Section */}
                    <div className="relative shrink-0">
                        <div className="w-28 h-28 rounded-[2rem] bg-gradient-to-br from-purple-500 to-blue-700 flex items-center justify-center shadow-[0_0_40px_rgba(147,51,234,0.4)] rotate-6 group-hover:rotate-0 transition-all duration-700 border border-white/20">
                            <i className="fas fa-play text-5xl text-white drop-shadow-[0_0_20px_rgba(255,255,255,0.6)]"></i>
                        </div>
                        <div className="absolute -top-3 -right-3 w-10 h-10 rounded-full bg-white/10 backdrop-blur-xl flex items-center justify-center border border-white/20 animate-pulse shadow-lg">
                            <i className="fas fa-crown text-sm text-yellow-400"></i>
                        </div>
                    </div>
                    
                    <div className="flex-1 text-center lg:text-left">
                        <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-purple-500/20 border border-purple-500/30 mb-4 backdrop-blur-md">
                            <span className="flex h-2 w-2 relative">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-purple-400 opacity-75"></span>
                                <span className="relative inline-flex rounded-full h-2 w-2 bg-purple-500"></span>
                            </span>
                            <span className="text-[11px] font-black text-purple-300 uppercase tracking-[0.2em]">PurTV Premium</span>
                        </div>
                        
                        <h3 className="text-3xl md:text-4xl font-black text-white mb-3 tracking-tighter leading-none">
                            purtv anime dan donghua
                        </h3>
                        
                        <p className="text-gray-400 mb-8 leading-relaxed font-medium max-w-2xl text-sm md:text-base">
                            Streaming koleksi anime dan donghua sub Indo terlengkap dengan kualitas Ultra HD. Nikmati update harian tanpa batas.
                        </p>
                        
                        <div className="flex flex-col sm:flex-row items-center gap-6 justify-center lg:justify-start">
                            <Link 
                                href="/listpage" 
                                className="group/btn relative bg-white text-black hover:text-white text-sm font-black px-10 py-4 rounded-2xl transition-all overflow-hidden shadow-[0_10px_30px_rgba(255,255,255,0.15)] hover:shadow-purple-500/20 active:scale-95 w-full sm:w-auto text-center"
                            >
                                <span className="absolute inset-0 bg-gradient-to-r from-purple-600 to-blue-600 translate-y-full group-hover/btn:translate-y-0 transition-transform duration-500"></span>
                                <span className="relative flex items-center justify-center gap-3">
                                    MULAI MENONTON <i className="fas fa-chevron-right text-xs group-hover/btn:translate-x-1 transition-transform"></i>
                                </span>
                            </Link>
                            
                            {/* Social Proof Indicator */}
                            <div className="flex items-center gap-4 bg-white/5 px-5 py-3 rounded-2xl border border-white/10 backdrop-blur-sm">
                                <div className="flex -space-x-3">
                                    {[
                                        "/anime-char-1.jpg",
                                        "/anime-char-2.jpg",
                                        "/anime-char-3.jpg"
                                    ].map((url, i) => (
                                        <div key={i} className="w-10 h-10 rounded-full border-2 border-[#111] bg-gray-800 overflow-hidden relative shadow-lg">
                                            <Image 
                                                src={url} 
                                                alt={`User ${i + 1}`} 
                                                fill 
                                                className="object-cover"
                                                sizes="40px"
                                                unoptimized
                                            />
                                        </div>
                                    ))}
                                </div>
                                <div className="flex flex-col items-start leading-tight">
                                    <span className="text-xs font-black text-white">+12k Active</span>
                                    <span className="text-[10px] text-gray-500 font-bold uppercase tracking-wider">Penonton</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <div className="text-center">
                <p className="text-muted text-[10px] uppercase tracking-[0.4em] font-black opacity-40">Tiyanz API &copy; {new Date().getFullYear()} • Crafted for Excellence</p>
            </div>
        </footer>
    );
}

'use client';

import React from 'react';
import Link from 'next/link';

export default function SupportPage() {
    return (
        <div className="container mx-auto px-4 py-12 max-w-4xl">
            <div className="text-center mb-10">
                <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-amber-500/10 border border-amber-500/20 mb-4">
                    <span className="text-amber-500 font-bold text-xs uppercase tracking-widest">Dukungan & Donasi</span>
                </div>
                <h1 className="text-3xl md:text-5xl font-black text-white mb-4 tracking-tight">
                    Terima Kasih Atas Dukungan Anda!
                </h1>
                <p className="text-gray-400 max-w-xl mx-auto text-sm md:text-base leading-relaxed">
                    Setiap dukungan dari Anda sangat berarti untuk membantu kelangsungan operasional server, perawatan API, dan pengembangan fitur baru.
                </p>
                <div className="mt-8 flex justify-center">
                    <a
                        href="https://saweria.co/puruboy"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-3 bg-[#EAA524] hover:bg-[#d8951a] text-black font-black px-8 py-4 rounded-2xl shadow-xl hover:shadow-amber-500/20 transition-all transform hover:-translate-y-0.5 active:translate-y-0 text-sm md:text-base"
                    >
                        <img 
                            src="https://saweria.co/favicon.ico" 
                            alt="Saweria Logo" 
                            className="w-6 h-6 rounded-md bg-white p-0.5"
                        />
                        <span>Dukung via Saweria (saweria.co/puruboy)</span>
                        <i className="fas fa-external-link-alt text-xs opacity-70"></i>
                    </a>
                </div>
            </div>

            {/* Leaderboard Section */}
            <div className="bg-zinc-900/80 border border-zinc-800 rounded-3xl p-6 md:p-8 shadow-2xl overflow-hidden backdrop-blur-sm mb-12">
                <h2 className="text-xl md:text-2xl font-black text-white mb-6 text-center flex items-center justify-center gap-3">
                    <i className="fas fa-trophy text-amber-400"></i> Leaderboard Supporters
                </h2>
                <div className="w-full overflow-hidden rounded-2xl border border-zinc-800 bg-black/50">
                    <iframe
                        src="https://saweria.co/widgets/leaderboard?streamKey=2f795858ba9218d431f755e36a19f3ee"
                        className="w-full h-[600px] border-0"
                        title="Saweria Leaderboard"
                    ></iframe>
                </div>
            </div>

            <div className="text-center">
                <Link className="inline-flex items-center gap-2 text-gray-400 hover:text-white font-semibold text-sm transition-colors" href="/">
                    <i className="fas fa-arrow-left text-xs"></i> Kembali ke Beranda
                </Link>
            </div>
        </div>
    );
}
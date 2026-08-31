'use client';

import React, { useState, useEffect, useCallback } from 'react';

const STEPS = [
    { icon: 'fa-wand-magic-sparkles', title: 'Pasang Manager', desc: 'Install Tampermonkey atau Violentmonkey di browser.' },
    { icon: 'fa-download', title: 'Klik Install', desc: 'Tekan tombol Install pada script yang kamu mau.' },
    { icon: 'fa-rotate', title: 'Auto Update', desc: 'Versi baru langsung terpasang tanpa repot.' },
];

const GRADIENTS = [
    'from-cyan-500 to-blue-600',
    'from-pink-500 to-rose-600',
    'from-violet-500 to-purple-600',
    'from-emerald-500 to-teal-600',
    'from-amber-500 to-orange-600',
];

const gradientFor = (id) => {
    let h = 0;
    for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return GRADIENTS[h % GRADIENTS.length];
};

export default function UserscriptStoreClient() {
    const [origin, setOrigin] = useState('');
    const [scripts, setScripts] = useState([]);
    const [page, setPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');

    useEffect(() => {
        setOrigin(window.location.origin);
    }, []);

    const fetchScripts = useCallback(async (p, q) => {
        setLoading(true);
        try {
            const res = await fetch(`/api/user-scripts?page=${p}&search=${encodeURIComponent(q)}`);
            const data = await res.json();
            setScripts(data.scripts || []);
            setTotalPages(data.totalPages || 0);
            setPage(data.currentPage || 1);
        } catch (e) {
            console.error('Failed to fetch scripts:', e);
        }
        setLoading(false);
    }, []);

    useEffect(() => {
        const timer = setTimeout(() => {
            fetchScripts(1, searchQuery);
        }, 500);
        return () => clearTimeout(timer);
    }, [fetchScripts, searchQuery]);

    useEffect(() => {
        if (page > 1 || !searchQuery) {
            fetchScripts(page, searchQuery);
        }
    }, [page, fetchScripts, searchQuery]);

    return (
        <div className="animate-fade-in pb-8">
            {/* Header */}
            <div className="sticky-header -mx-4 px-4 py-4 mb-6 flex justify-between items-end">
                <div>
                    <h1 className="text-2xl font-bold text-primary tracking-tight">UserScript Store</h1>
                    <p className="text-xs text-secondary mt-1">Script browser gratis, auto-update, buatan PuruBoy</p>
                </div>
                <div className="w-10 h-10 bg-accent/10 rounded-full flex items-center justify-center text-accent">
                    <i className="fas fa-cubes"></i>
                </div>
            </div>

            {/* Cara pasang */}
            <div className="mb-6">
                <div className="grid grid-cols-3 gap-2">
                    {STEPS.map((step, i) => (
                        <div key={step.title} className="native-card p-3 text-center">
                            <div className="w-8 h-8 rounded-xl bg-accent/10 flex items-center justify-center text-accent mx-auto mb-2">
                                <i className={`fas ${step.icon} text-xs`}></i>
                            </div>
                            <div className="text-[10px] font-bold text-primary">
                                <span className="text-accent">{i + 1}.</span> {step.title}
                            </div>
                            <div className="text-[9px] text-muted mt-1 leading-snug">{step.desc}</div>
                        </div>
                    ))}
                </div>
            </div>

            {/* Pencarian */}
            <div className="mb-6 relative">
                <i className="fas fa-search absolute left-4 top-1/2 -translate-y-1/2 text-muted text-sm"></i>
                <input
                    type="text"
                    placeholder="Cari script..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full bg-input border border-default rounded-2xl py-3 pl-11 pr-4 text-sm text-primary focus:outline-none focus:border-accent transition-all shadow-inner"
                />
            </div>

            {/* Daftar script */}
            {loading && scripts.length === 0 ? (
                <div className="text-center py-10">
                    <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin mx-auto"></div>
                </div>
            ) : scripts.length > 0 ? (
                <div className="space-y-4">
                    {scripts.map((script) => {
                        const installUrl = origin ? `${origin}/userscripts/${script.file}` : '';
                        return (
                            <div key={script.id} className="native-card overflow-hidden">
                                <div className="p-4 space-y-4">
                                    {/* Header script */}
                                    <div className="flex items-start gap-3">
                                        <div className={`w-12 h-12 rounded-2xl bg-gradient-to-br ${gradientFor(script.id)} flex items-center justify-center shadow-lg shrink-0`}>
                                            <i className={`fas ${script.icon || 'fa-cubes'} text-white text-lg`}></i>
                                        </div>
                                        <div className="min-w-0 flex-1">
                                            <div className="flex items-center gap-2 flex-wrap">
                                                <h3 className="font-bold text-primary text-sm">{script.name}</h3>
                                                <span className="text-[9px] font-mono bg-accent/10 text-accent border border-accent/20 px-1.5 py-0.5 rounded-full font-bold">v{script.version}</span>
                                            </div>
                                            <div className="text-[10px] text-muted mt-0.5">oleh {script.author}</div>
                                            <p className="text-xs text-secondary mt-2 leading-relaxed">{script.description}</p>
                                        </div>
                                    </div>

                                    {/* Tombol install */}
                                    <a
                                        href={installUrl}
                                        className="flex w-full items-center justify-center gap-2 bg-accent hover:bg-accent-hover text-white font-bold py-3 rounded-xl shadow-lg shadow-accent/25 transition-all active:scale-95"
                                    >
                                        <i className="fas fa-download text-sm"></i>
                                        Install Script
                                    </a>
                                </div>

                                <div className="px-4 py-2.5 bg-input/50 border-t border-default flex items-center justify-between gap-2 flex-wrap">
                                    <span className="text-[10px] text-muted flex items-center gap-2">
                                        <i className="fas fa-rotate text-[9px]"></i>
                                        Auto-update aktif via Tampermonkey / Violentmonkey
                                    </span>
                                    {script.match && (
                                        <span className="text-[10px] font-mono text-muted flex items-center gap-2">
                                            <i className="fas fa-globe text-[9px]"></i>
                                            {script.match}
                                        </span>
                                    )}
                                </div>
                            </div>
                        );
                    })}

                    {totalPages > 1 && (
                        <div className="flex justify-between items-center mt-6">
                            <button
                                disabled={page === 1}
                                onClick={() => setPage(p => p - 1)}
                                className="text-xs font-bold px-4 py-2 bg-input border border-default hover:bg-white/5 rounded-xl disabled:opacity-50 transition-colors"
                            >
                                <i className="fas fa-chevron-left mr-1"></i> Prev
                            </button>
                            <span className="text-xs font-bold text-muted bg-card px-3 py-1.5 rounded-lg border border-default">
                                {page} / {totalPages}
                            </span>
                            <button
                                disabled={page === totalPages}
                                onClick={() => setPage(p => p + 1)}
                                className="text-xs font-bold px-4 py-2 bg-input border border-default hover:bg-white/5 rounded-xl disabled:opacity-50 transition-colors"
                            >
                                Next <i className="fas fa-chevron-right ml-1"></i>
                            </button>
                        </div>
                    )}
                </div>
            ) : (
                <div className="text-center py-20 text-muted">
                    <i className="fas fa-ghost text-4xl mb-3 opacity-50"></i>
                    <p>Tidak ada script ditemukan.</p>
                </div>
            )}

            {/* Keamanan */}
            <div className="mt-6 native-card p-4">
                <div className="flex items-center gap-3 mb-2">
                    <i className="fas fa-shield-halved text-accent text-lg"></i>
                    <h2 className="text-sm font-bold text-primary">Aman & Transparan</h2>
                </div>
                <p className="text-xs text-secondary leading-relaxed">
                    Kode semua script terbuka penuh di GitHub. Selalu pasang manager script hanya dari sumber resmi
                    (tampermonkey.net / violentmonkey.com) dan tinjau kodenya sebelum mengaktifkan.
                </p>
            </div>
        </div>
    );
}
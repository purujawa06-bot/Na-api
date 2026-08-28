'use client';

import React, { useState, useEffect } from 'react';

const STEPS = [
    { icon: 'fa-wand-magic-sparkles', title: 'Pasang Manager', desc: 'Install Tampermonkey atau Violentmonkey di browser.' },
    { icon: 'fa-download', title: 'Klik Install', desc: 'Tekan tombol Install pada script yang kamu mau.' },
    { icon: 'fa-rotate', title: 'Auto Update', desc: 'Versi baru langsung terpasang tanpa repot.' },
];

export default function UserscriptStoreClient({ scripts }) {
    const [origin, setOrigin] = useState('');

    useEffect(() => {
        setOrigin(window.location.origin);
    }, []);

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

            {/* Daftar script */}
            <div className="space-y-4">
                {scripts.map((script) => {
                    const installUrl = origin ? `${origin}/userscripts/${script.file}` : '';
                    return (
                        <div key={script.id} className="native-card overflow-hidden">
                            <div className="p-4 space-y-4">
                                {/* Header script */}
                                <div className="flex items-start gap-3">
                                    <div className={`w-12 h-12 rounded-2xl bg-gradient-to-br ${script.color} flex items-center justify-center shadow-lg shrink-0`}>
                                        <i className={`fas ${script.icon} text-white text-lg`}></i>
                                    </div>
                                    <div className="min-w-0 flex-1">
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <h3 className="font-bold text-primary text-sm">{script.name}</h3>
                                            <span className="text-[9px] font-mono bg-accent/10 text-accent border border-accent/20 px-1.5 py-0.5 rounded-full font-bold">v{script.version}</span>
                                        </div>
                                        <div className="text-[10px] text-muted mt-0.5">oleh {script.author}</div>
                                        <p className="text-xs text-secondary mt-2 leading-relaxed">{script.summary}</p>
                                    </div>
                                </div>

                                {/* Tags */}
                                <div className="flex flex-wrap gap-1.5">
                                    {script.tags.map((tag) => (
                                        <span key={tag} className="text-[9px] bg-input border border-default px-2 py-1 rounded-full text-muted font-bold uppercase tracking-wider">{tag}</span>
                                    ))}
                                </div>

                                {/* Fitur */}
                                <ul className="space-y-1.5">
                                    {script.features.map((feat, i) => (
                                        <li key={i} className="flex items-start gap-2 text-xs text-secondary">
                                            <i className="fas fa-check text-green-400 text-[10px] mt-1"></i>
                                            <span className="leading-snug">{feat}</span>
                                        </li>
                                    ))}
                                </ul>

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
                                <span className="text-[10px] font-mono text-muted flex items-center gap-2">
                                    <i className="fas fa-globe text-[9px]"></i>
                                    {script.match}
                                </span>
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* Keamanan */}
            <div className="mt-6 native-card p-4">
                <div className="flex items-center gap-3 mb-2">
                    <i className="fas fa-shield-halved text-accent text-lg"></i>
                    <h2 className="text-sm font-bold text-primary">Aman & Transparan</h2>
                </div>
                <p className="text-xs text-secondary leading-relaxed">
                    Kode semua script terbuka penuh. Selalu pasang manager script hanya dari sumber resmi
                    (tampermonkey.net / violentmonkey.com) dan tinjau kodenya sebelum mengaktifkan.
                </p>
            </div>
        </div>
    );
}
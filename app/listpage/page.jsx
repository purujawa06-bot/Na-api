'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { apiUrl } from '../../lib/apiBase';

export default function ListPage() {
    const [pages, setPages] = useState([]);
    const [page, setPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');

    const fetchPages = useCallback(async (p) => {
        setLoading(true);
        try {
            const res = await fetch(apiUrl(`/api/pages?page=${p}&search=${encodeURIComponent(searchQuery)}`));
            const data = await res.json();
            setPages(data.pages || []);
            setTotalPages(data.totalPages || 0);
            setPage(data.currentPage || 1);
        } catch (e) {
            console.error('Failed to fetch pages:', e);
        }
        setLoading(false);
    }, [searchQuery]);

    useEffect(() => {
        const timer = setTimeout(() => {
            fetchPages(1);
        }, 500);
        return () => clearTimeout(timer);
    }, [fetchPages]);

    useEffect(() => {
        if (page > 1 || !searchQuery) {
            fetchPages(page);
        }
    }, [page, fetchPages, searchQuery]);

    return (
        <div className="animate-fade-in pb-8">
            <div className="sticky-header -mx-4 px-4 py-4 mb-6 flex justify-between items-end">
                <div>
                    <h1 className="text-2xl font-bold text-primary tracking-tight">Custom Pages</h1>
                    <p className="text-xs text-secondary mt-1">Daftar halaman yang tersedia</p>
                </div>
                <div className="w-10 h-10 bg-accent/10 rounded-full flex items-center justify-center text-accent">
                    <i className="fas fa-file-alt"></i>
                </div>
            </div>

            <div className="mb-6 relative">
                <i className="fas fa-search absolute left-4 top-1/2 -translate-y-1/2 text-muted text-sm"></i>
                <input 
                    type="text" 
                    placeholder="Cari halaman..." 
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full bg-input border border-default rounded-2xl py-3 pl-11 pr-4 text-sm text-primary focus:outline-none focus:border-accent transition-all shadow-inner"
                />
            </div>

            {loading && pages.length === 0 ? (
                <div className="text-center py-10">
                    <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin mx-auto"></div>
                </div>
            ) : pages.length > 0 ? (
                <div className="space-y-4">
                    {pages.map(p => (
                        <div key={p.slug} className="native-card p-4 hover:border-accent/40 transition-colors">
                            <h3 className="font-bold text-primary text-sm mb-1">{p.title}</h3>
                            <p className="text-xs text-secondary mb-3 leading-relaxed">{p.description || 'Tidak ada deskripsi.'}</p>
                            <Link 
                                href={`/page/${p.slug}`} 
                                target="_blank" 
                                className="inline-flex items-center gap-2 bg-accent/10 text-accent hover:bg-accent hover:text-white text-xs font-bold px-4 py-2 rounded-xl transition-all"
                            >
                                <i className="fas fa-external-link-alt"></i> Buka Halaman
                            </Link>
                        </div>
                    ))}

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
                    <p>Tidak ada halaman ditemukan.</p>
                </div>
            )}
        </div>
    );
}
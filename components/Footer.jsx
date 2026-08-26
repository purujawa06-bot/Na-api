'use client';

import React from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';

export default function Footer() {
    const pathname = usePathname();

    // Sembunyikan footer di halaman chat, docs, dan support
    if (pathname === '/chat' || pathname.startsWith('/docs') || pathname === '/support') return null;

    return (
        <footer className="mt-12 border-t border-default pt-8 pb-28 px-4">
            <div className="flex flex-col items-center justify-center gap-6 mb-8">
                <Link 
                    href="/support"
                    className="inline-flex items-center gap-3 bg-[#EAA524] hover:bg-[#d8951a] text-black font-black px-8 py-4 rounded-2xl shadow-lg hover:shadow-amber-500/20 transition-all transform hover:scale-105 active:scale-95 text-base"
                >
                    <Image 
                        src="https://saweria.co/favicon.ico" 
                        alt="Saweria Logo" 
                        width={24}
                        height={24}
                        unoptimized
                        className="rounded-md bg-white p-0.5" 
                    />
                    <span>Support Saya</span>
                    <i className="fas fa-chevron-right text-xs opacity-70"></i>
                </Link>
            </div>

            <div className="text-center">
                <p className="text-muted text-[10px] uppercase tracking-[0.4em] font-black opacity-40">
                    PuruBoy API &copy; {new Date().getFullYear()} • Crafted for Excellence
                </p>
            </div>
        </footer>
    );
}
'use client';
import React, { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';

const Navbar = () => {
    const [isOpen, setIsOpen] = useState(false);
    const pathname = usePathname();

    const navLinks = [
        { name: 'Home', href: '/', icon: 'fa-home' },
        { name: 'Docs', href: '/docs', icon: 'fa-book-open' },
        { name: 'Chat', href: '/chat', icon: 'fa-comments' },
        { name: 'Blog', href: '/blog', icon: 'fa-newspaper' },
    ];

    return (
        <>
            {/* Desktop Header */}
            <header className="fixed top-0 left-0 right-0 z-50 hidden md:flex items-center justify-between px-6 py-4 backdrop-blur-md bg-card/50 border-b border-default">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center shadow-lg overflow-hidden border border-white/10 relative">
                        <Image src="/favicon.jpg" alt="Logo" width={40} height={40} className="w-full h-full object-cover" />
                    </div>
                    <span className="font-black text-white tracking-tighter text-lg">PuruBoy API</span>
                </div>

                <button 
                    onClick={() => setIsOpen(!isOpen)}
                    className="w-12 h-12 rounded-2xl bg-default hover:bg-default/80 text-white flex items-center justify-center transition-all duration-300 active:scale-90 border border-white/10"
                >
                    <i className={`fas ${isOpen ? 'fa-times' : 'fa-bars'} text-xl`}></i>
                </button>
            </header>

            {/* Desktop Side Menu */}
            <div className={`fixed inset-y-0 right-0 z-[60] w-72 bg-card border-l border-default transition-transform duration-500 ease-in-out transform ${isOpen ? 'translate-x-0' : 'translate-x-full'} md:block`}>
                <div className="p-6 flex flex-col h-full">
                    <div className="flex items-center justify-between mb-10">
                        <span className="font-black text-white text-xl">Menu</span>
                        <button 
                            onClick={() => setIsOpen(false)}
                            className="w-8 h-8 rounded-lg bg-default text-white flex items-center justify-center"
                        >
                            <i className="fas fa-times"></i>
                        </button>
                    </div>

                    <nav className="flex flex-col gap-3">
                        {navLinks.map((link) => {
                            const isActive = link.href === '/' ? pathname === '/' : pathname.startsWith(link.href);
                            return (
                                <Link 
                                    key={link.href} 
                                    href={link.href}
                                    onClick={() => setIsOpen(false)}
                                    className={`flex items-center gap-4 px-4 py-3 rounded-2xl transition-all duration-300 ${isActive ? 'bg-purple-500 text-white shadow-lg shadow-purple-500/30' : 'text-muted hover:bg-default hover:text-white'}`}
                                >
                                    <i className={`fas ${link.icon} w-5 text-center`}></i>
                                    <span className="font-bold">{link.name}</span>
                                </Link>
                            );
                        })}
                    </nav>

                    <div className="mt-auto pt-6 border-t border-default">
                        <div className="p-4 rounded-2xl bg-default/50 border border-white/5">
                            <p className="text-xs text-muted text-center font-medium">PuruBoy API &copy; {new Date().getFullYear()}</p>
                        </div>
                    </div>
                </div>
            </div>

            {/* Overlay for Side Menu */}
            {isOpen && (
                <div 
                    className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[55] md:block"
                    onClick={() => setIsOpen(false)}
                ></div>
            )}
        </>
    );
};

export default Navbar;

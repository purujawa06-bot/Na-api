
'use client';
import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const BottomNav = () => {
    const [isOpen, setIsOpen] = React.useState(false);
    const pathname = usePathname();

    const navLinks = [
        { name: 'Home', href: '/', icon: 'fa-home' },
        { name: 'Docs', href: '/docs', icon: 'fa-book-open' },
        { name: 'Chat', href: '/chat', icon: 'fa-comments' },
        { name: 'Blog', href: '/blog', icon: 'fa-newspaper' },
    ];

    // Sembunyikan navigasi bawah pada halaman chat agar tampilan lebih luas/mirip aplikasi native
    if (pathname === '/chat') return null;

    return (
        <>
            {/* Bottom Bar */}
            <nav className="fixed bottom-0 left-0 right-0 h-20 bg-card/80 backdrop-blur-lg border-t border-default z-50 md:hidden flex items-center justify-center shadow-2xl shadow-black">
                <button
                    onClick={() => setIsOpen(!isOpen)}
                    className="w-14 h-14 rounded-full bg-purple-600 text-white flex items-center justify-center shadow-lg shadow-purple-600/40 active:scale-90 transition-all duration-300"
                >
                    <i className={`fas ${isOpen ? 'fa-times' : 'fa-bars'} text-xl`}></i>
                </button>
            </nav>

            {/* Bottom Sheet Menu */}
            <div className={`fixed inset-x-0 bottom-0 z-[60] bg-card border-t border-default transition-transform duration-500 ease-in-out transform ${isOpen ? 'translate-y-0' : 'translate-y-full'} md:hidden rounded-t-[2.5rem] shadow-2xl`}>
                <div className="p-6 flex flex-col gap-4">
                    <div className="w-12 h-1.5 bg-default rounded-full mx-auto mb-6"></div>
                    
                    <div className="grid grid-cols-2 gap-3">
                        {navLinks.map((link) => {
                            const isActive = link.href === '/' ? pathname === '/' : pathname.startsWith(link.href);
                            return (
                                <Link
                                    key={link.href}
                                    href={link.href}
                                    onClick={() => setIsOpen(false)}
                                    className={`flex items-center gap-3 p-4 rounded-2xl transition-all duration-300 ${isActive ? 'bg-purple-500 text-white shadow-lg shadow-purple-500/30' : 'bg-default text-muted hover:text-white'}`}
                                >
                                    <i className={`fas ${link.icon} w-5 text-center`}></i>
                                    <span className="font-bold text-sm">{link.name}</span>
                                </Link>
                            );
                        })}
                    </div>
                </div>
            </div>

            {/* Overlay */}
            {isOpen && (
                <div
                    className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[55] md:hidden"
                    onClick={() => setIsOpen(false)}
                ></div>
            )}
        </>
    );
};

export default BottomNav;
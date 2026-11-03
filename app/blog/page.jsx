import React from 'react';
import BlogClient from '../../components/BlogClient';

export const metadata = {
    title: 'Blog & Tutorial | PuruBoy API',
    description: 'Blog resmi PuruBoy API. Dapatkan tutorial penggunaan API, informasi update fitur terbaru, changelog sistem, dan tips & trik untuk developer Indonesia.',
    keywords: ['Blog PuruBoy API', 'Tutorial API Indonesia', 'Update API', 'Changelog', 'Tips Developer', 'PuruBoy Tutorial'],
    openGraph: {
        title: 'Blog & Tutorial PuruBoy API',
        description: 'Tutorial, update fitur, dan tips seputar PuruBoy API untuk developer Indonesia.',
        url: 'http://na-api.puruboy.duckdns.org/blog',
        siteName: 'PuruBoy API',
        type: 'website',
    },
};

export const revalidate = 60;

export default async function BlogPage() {
    const initialPosts = [];
    const totalPages = 1;
    const error = null;

    return (
        <div className="animate-fade-in pb-8">
            <div className="sticky-header -mx-4 px-4 py-4 mb-6 flex justify-between items-end">
                <div>
                    <h1 className="text-2xl font-bold text-primary tracking-tight">Blog Updates</h1>
                    <p className="text-xs text-secondary mt-1">Berita & Tutorial PuruBoy API</p>
                </div>
                <div className="w-10 h-10 bg-accent/10 rounded-full flex items-center justify-center text-accent">
                    <i className="fas fa-newspaper"></i>
                </div>
            </div>
            <BlogClient initialPosts={initialPosts} totalPages={totalPages} />
        </div>
    );
}
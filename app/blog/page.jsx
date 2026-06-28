import React from 'react';
import blogService from '../../lib/blogService';
import BlogClient from '../../components/BlogClient';

export const metadata = {
    title: 'Blog & Tutorial | PuruBoy API',
    description: 'Blog resmi PuruBoy API. Dapatkan tutorial penggunaan API, informasi update fitur terbaru, changelog sistem, dan tips & trik untuk developer Indonesia.',
    keywords: ['Blog PuruBoy API', 'Tutorial API Indonesia', 'Update API', 'Changelog', 'Tips Developer', 'PuruBoy Tutorial'],
    openGraph: {
        title: 'Blog & Tutorial PuruBoy API',
        description: 'Tutorial, update fitur, dan tips seputar PuruBoy API untuk developer Indonesia.',
        url: 'https://puruboy-api.vercel.app/blog',
        siteName: 'PuruBoy API',
        type: 'website',
    },
};

export const revalidate = 60;

export default async function BlogPage() {
    let initialPosts = [];
    let totalPages = 1;
    let error = null;

    const page = 1;
    const limit = 5;

    try {
        const data = await blogService.getAll(page, limit);
        initialPosts = Array.isArray(data?.posts) ? data.posts : [];
        totalPages = data?.totalPages || 1;
    } catch (err) {
        console.error("Failed to fetch blogs:", err);
        error = "Gagal memuat postingan blog.";
        initialPosts = [];
    }

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

            {error ? (
                <div className="bg-red-900/20 border border-red-800 p-6 rounded-2xl text-center">
                    <i className="fas fa-exclamation-circle text-red-500 text-2xl mb-2"></i>
                    <p className="text-red-300 text-sm">{error}</p>
                </div>
            ) : (initialPosts && initialPosts.length > 0) ? (
                <BlogClient 
                    initialPosts={initialPosts} 
                    totalPages={totalPages} 
                />
            ) : (
                <div className="text-center py-20 text-muted flex flex-col items-center">
                    <i className="far fa-folder-open text-4xl mb-3 opacity-50"></i>
                    <p>Belum ada postingan.</p>
                </div>
            )}
        </div>
    );
}
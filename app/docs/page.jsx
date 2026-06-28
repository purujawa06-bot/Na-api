import React, { Suspense } from 'react';
import { getDocsSpec } from '../../lib/docsService';
import DocsClient from '../../components/DocsClient';

export const metadata = {
    title: 'Dokumentasi Lengkap | PuruBoy API',
    description: 'Jelajahi dan coba langsung seluruh endpoint REST API PuruBoy. Dokumentasi interaktif untuk fitur AI (DeepSeek, Gemini, Flux), Downloader (TikTok, YouTube, IG), Anime Streaming, Search, dan Tools lengkap dengan Try It Out!',
    keywords: ['Dokumentasi API PuruBoy', 'API Docs Indonesia', 'REST API Documentation', 'PuruBoy Endpoints', 'Cara Pakai PuruBoy API', 'API AI Documentation', 'Try API Online'],
    openGraph: {
        title: 'Dokumentasi API - PuruBoy API',
        description: 'Dokumentasi interaktif lengkap endpoint REST API PuruBoy. Coba langsung dari browser!',
        url: 'https://puruboy-api.vercel.app/docs',
        siteName: 'PuruBoy API',
        type: 'website',
    },
};

export const revalidate = 3600;

export default async function DocsPage() {
    let apiSpec = {};
    let error = null;

    try {
        apiSpec = await getDocsSpec();
    } catch (err) {
        console.error("SSG Error:", err);
        error = "Gagal memuat spesifikasi API saat build time.";
    }

    if (error) {
        return (
            <div className="p-6 text-center text-red-400">
                <h1 className="text-xl font-bold mb-2">Error</h1>
                <p>{error}</p>
            </div>
        );
    }

    return (
        <Suspense fallback={
            <div className="flex flex-col items-center justify-center py-20 min-h-[60vh]">
                <div className="w-10 h-10 border-4 border-accent border-t-transparent rounded-full animate-spin mb-4"></div>
                <p className="text-muted text-sm animate-pulse">Menyiapkan dokumentasi...</p>
            </div>
        }>
            <DocsClient apiSpec={apiSpec} />
        </Suspense>
    );
}
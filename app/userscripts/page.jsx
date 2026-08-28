import React from 'react';
import UserscriptStoreClient from '../../components/UserscriptStoreClient';
import { SCRIPTS } from '../../lib/userscripts-store';

export const metadata = {
    title: 'UserScript Store | PuruBoy API',
    description: 'Koleksi UserScript gratis buatan PuruBoy API. Popup pengambil userToken chat.deepseek.com dan lainnya — pasang sekali, auto-update otomatis lewat Tampermonkey / Violentmonkey.',
    keywords: ['UserScript Store', 'Tampermonkey', 'Violentmonkey', 'DeepSeek Token', 'UserScript Indonesia', 'PuruBoy Script'],
    openGraph: {
        title: 'UserScript Store - PuruBoy API',
        description: 'UserScript gratis dengan auto-update untuk mempermudah pakai API PuruBoy.',
        url: 'https://puruboy-api.vercel.app/userscripts',
        siteName: 'PuruBoy API',
        type: 'website',
    },
};

export default function UserscriptsPage() {
    return <UserscriptStoreClient scripts={SCRIPTS} />;
}
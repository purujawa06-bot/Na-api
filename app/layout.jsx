import React from 'react';
import Script from 'next/script';
import './globals.css';
import Navbar from '../components/Navbar';
import BottomNav from '../components/BottomNav';
import NextNProgress from '../components/NextNProgress';
import Footer from '../components/Footer';
import FeaturedPopup from '../components/FeaturedPopup';
import ErrorReportPopup from '../components/ErrorReportPopup';
import JsonLd from '../components/JsonLd';

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  interactiveWidget: 'resizes-content',
};

export const metadata = {
  metadataBase: new URL('https://puruboy-api.vercel.app'),
  title: {
    default: 'PuruBoy API - Platform REST API Gratis untuk Developer Indonesia',
    template: '%s | PuruBoy API'
  },
  description: 'PuruBoy API adalah platform REST API gratis untuk developer Indonesia. Nikmati layanan AI Chat (DeepSeek, GPT, Gemini), Downloader (TikTok, YouTube, IG), Anime Streaming, dan Tools lengkap. Cepat, stabil, dan mudah diintegrasikan.',
  keywords: ['PuruBoy API', 'REST API Gratis', 'API Indonesia', 'API AI Gratis', 'TikTok Downloader API', 'YouTube API Gratis', 'Anime Streaming API', 'Developer Tools', 'PuruBoy', 'API Publik Indonesia', 'Web Service API', 'Free REST API Indonesia'],
  authors: [{ name: 'PuruBoy', url: 'https://github.com/purujawa06-bot' }],
  creator: 'PuruBoy',
  publisher: 'PuruBoy',
  alternates: {
    canonical: 'https://puruboy-api.vercel.app',
  },
  openGraph: {
    title: 'PuruBoy API - Platform REST API Gratis & Modular',
    description: 'Akses ratusan endpoint API gratis untuk AI, Downloader, Anime, dan Tools. Dokumentasi lengkap, respons cepat, dan gratis untuk semua developer Indonesia.',
    url: 'https://puruboy-api.vercel.app',
    siteName: 'PuruBoy API',
    locale: 'id_ID',
    type: 'website',
    images: [
      {
        url: 'https://puruboy-api.vercel.app/og',
        width: 1200,
        height: 630,
        alt: 'PuruBoy API - Platform REST API Gratis Indonesia',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'PuruBoy API - Platform REST API & Tools AI Gratis',
    description: 'Platform REST API gratis untuk developer Indonesia dengan fitur AI, Downloader, Anime, dan Tools.',
    creator: '@puruboy',
    images: ['https://puruboy-api.vercel.app/og'],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
  icons: {
    icon: [
      { url: '/favicon.jpg', type: 'image/jpeg' },
      { url: '/favicon.ico', sizes: 'any' },
    ],
    apple: '/favicon.jpg',
  },
  verification: {
    google: 'google41f3f05fef8cd977',
  },
  category: 'technology',
  manifest: '/manifest.json',
};

export default function RootLayout({ children }) {
  return (
    <html lang="id">
      <body className="antialiased pb-24">
        <JsonLd />
        <Script 
          src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js" 
          strategy="afterInteractive" 
        />
        
        <NextNProgress />
        <FeaturedPopup />
        <ErrorReportPopup />
        <Navbar />
        
        <div className="background-animation"></div>
        
        {/* Menggunakan min-h-dvh untuk stabilitas viewport pada mobile */}
        <div className="container mx-auto px-4 max-w-md md:max-w-3xl min-h-dvh relative z-10 pt-6 md:pt-24">
            <main className="relative z-20">{children}</main>
            <Footer />
        </div>
        <BottomNav />
      </body>
    </html>
  );
}
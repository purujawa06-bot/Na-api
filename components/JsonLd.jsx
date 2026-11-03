'use client';

export default function JsonLd() {
  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebApplication',
        name: 'PuruBoy API',
        url: 'http://na-api.puruboy.duckdns.org',
        description: 'Platform REST API gratis untuk developer dengan fitur AI, Downloader, Anime Streaming, dan Tools.',
        applicationCategory: 'DeveloperApplication',
        operatingSystem: 'All',
        author: {
          '@type': 'Person',
          name: 'PuruBoy',
          url: 'https://github.com/purujawa06-bot',
        },
        offers: {
          '@type': 'Offer',
          price: '0',
          priceCurrency: 'IDR',
          description: 'Gratis untuk semua developer',
        },
      },
      {
        '@type': 'WebSite',
        name: 'PuruBoy API',
        url: 'http://na-api.puruboy.duckdns.org',
        description: 'Platform API modular terbaik dengan integrasi AI, Downloader, dan Anime Streaming. Gratis, cepat, dan mudah digunakan.',
        about: {
          '@type': 'Thing',
          name: 'PuruBoy API – Solusi API Gratis untuk Developer Indonesia',
          description: 'PuruBoy API adalah platform REST API gratis yang menyediakan berbagai layanan untuk developer, termasuk AI Chat, Text to Image, Downloader multimedia, dan tools pengembangan web.'
        },
        inLanguage: ['id', 'en'],
        publisher: {
          '@type': 'Person',
          name: 'PuruBoy',
        },
        potentialAction: {
          '@type': 'SearchAction',
          target: 'http://na-api.puruboy.duckdns.org/search?q={search_term_string}',
          'query-input': 'required name=search_term_string',
        },
      },
      {
        '@type': 'CollectionPage',
        name: 'Dokumentasi API – PuruBoy API',
        description: 'Dokumentasi lengkap endpoint REST API PuruBoy: AI, Downloader, Anime, Tools, dan Search.',
        url: 'http://na-api.puruboy.duckdns.org/docs',
        isPartOf: {
          '@type': 'WebSite',
          name: 'PuruBoy API',
          url: 'http://na-api.puruboy.duckdns.org',
        },
      },
      {
        '@type': 'BreadcrumbList',
        name: 'Breadcrumb',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Beranda', item: 'http://na-api.puruboy.duckdns.org/' },
          { '@type': 'ListItem', position: 2, name: 'Dokumentasi', item: 'http://na-api.puruboy.duckdns.org/docs' },
          { '@type': 'ListItem', position: 3, name: 'Blog', item: 'http://na-api.puruboy.duckdns.org/blog' },
          { '@type': 'ListItem', position: 4, name: 'Chat Room', item: 'http://na-api.puruboy.duckdns.org/chat' },
        ],
      },
    ],
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
    />
  );
}

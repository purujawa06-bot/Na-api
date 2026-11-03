'use client';

export default function JsonLd() {
  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebApplication',
        name: 'PuruBoy API',
        url: 'https://purujawa06-bot.github.io/Na-api',
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
        url: 'https://purujawa06-bot.github.io/Na-api',
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
          target: 'https://purujawa06-bot.github.io/Na-api/search?q={search_term_string}',
          'query-input': 'required name=search_term_string',
        },
      },
      {
        '@type': 'CollectionPage',
        name: 'Dokumentasi API – PuruBoy API',
        description: 'Dokumentasi lengkap endpoint REST API PuruBoy: AI, Downloader, Anime, Tools, dan Search.',
        url: 'https://purujawa06-bot.github.io/Na-api/docs',
        isPartOf: {
          '@type': 'WebSite',
          name: 'PuruBoy API',
          url: 'https://purujawa06-bot.github.io/Na-api',
        },
      },
      {
        '@type': 'BreadcrumbList',
        name: 'Breadcrumb',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Beranda', item: 'https://purujawa06-bot.github.io/Na-api/' },
          { '@type': 'ListItem', position: 2, name: 'Dokumentasi', item: 'https://purujawa06-bot.github.io/Na-api/docs' },
          { '@type': 'ListItem', position: 3, name: 'Blog', item: 'https://purujawa06-bot.github.io/Na-api/blog' },
          { '@type': 'ListItem', position: 4, name: 'Chat Room', item: 'https://purujawa06-bot.github.io/Na-api/chat' },
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

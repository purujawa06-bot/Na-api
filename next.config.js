/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false, // Nonaktifkan strict mode untuk menghindari double-invocation pada useEffect di dev (opsional)
  experimental: {
    // Jangan bundle `ws` (dipakai lib/bing-cdp.js): bundling merusak
    // optional native `bufferutil` sehingga production error
    // "t.mask is not a function". Biarkan require saat runtime.
    serverComponentsExternalPackages: ['ws'],
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'avatars.githubusercontent.com',
      },
      {
        protocol: 'https',
        hostname: 'images.unsplash.com',
      },
      {
        protocol: 'https',
        hostname: 'cdn.pixabay.com',
      },
      {
        protocol: 'https',
        hostname: 'i.pinimg.com',
      },
      {
        protocol: 'https',
        hostname: 'raw.githubusercontent.com',
      },
      {
        protocol: 'https',
        hostname: 'api.dicebear.com',
      },
      {
        protocol: 'https',
        hostname: 'saweria.co',
      },
      {
        protocol: 'https',
        hostname: 'anichin.cafe',
      },
      {
        protocol: 'https',
        hostname: 'anichin.com.co',
      },
      {
        protocol: 'https',
        hostname: 'i0.wp.com',
      },
      {
        protocol: 'https',
        hostname: 'i1.wp.com',
      },
      {
        protocol: 'https',
        hostname: 'i2.wp.com',
      },
      {
        protocol: 'https',
        hostname: 'i3.wp.com',
      },
      {
        protocol: 'https',
        hostname: 'v2.samehadaku.how',
      },
    ],
  },
  async rewrites() {
    return [
      {
        source: '/admin',
        destination: '/admin.html',
      },
      // Fix Favicon untuk Search Engine (Map .ico request ke .jpg)
      {
        source: '/favicon.ico',
        destination: '/favicon.jpg',
      },
    ];
  },
};

module.exports = nextConfig;
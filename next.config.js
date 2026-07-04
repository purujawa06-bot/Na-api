/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false, // Nonaktifkan strict mode untuk menghindari double-invocation pada useEffect di dev (opsional)
  serverComponentsExternalPackages: ['ffmpeg-static'],
  experimental: {
    serverComponentsExternalPackages: ['ffmpeg-static'],
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
        hostname: 'picoclaw.io',
      },
    ],
  },
  async headers() {
    return [
      {
        // Terapkan header CORS dan Contact ke semua rute API
        source: "/api/:path*",
        headers: [
          { key: "Access-Control-Allow-Credentials", value: "true" },
          { key: "Access-Control-Allow-Origin", value: "*" }, // Izinkan akses dari semua domain
          { key: "Access-Control-Allow-Methods", value: "GET,DELETE,PATCH,POST,PUT" },
          { key: "Access-Control-Allow-Headers", value: "X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version" },
          { key: "Contact", value: "https://t.me/puruboy_hub" } // Header kontak tambahan
        ]
      }
    ]
  },
  async rewrites() {
    return [
      {
        source: '/admin',
        destination: '/admin.html',
      },
      {
        source: '/fastupdate',
        destination: '/fastupdate.html',
      },
      // Mapping endpoint lama agar kompatibel dengan frontend
      {
        source: '/download',
        destination: '/api/fastupdate/download',
      },
      {
        source: '/update',
        destination: '/api/fastupdate/update',
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
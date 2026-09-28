import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  images: { remotePatterns: [{ protocol: 'https', hostname: 'api.example-shop.com', pathname: '/medias/**' }] },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
        ],
      },
    ];
  },
};

export default nextConfig;

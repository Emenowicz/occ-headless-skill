import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'api.example-shop.com', port: '', pathname: '/medias/**', search: '' },
    ],
  },
};

export default nextConfig;

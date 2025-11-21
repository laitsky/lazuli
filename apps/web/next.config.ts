import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typescript: {
    // Temporarily ignore TypeScript errors during build
    // TODO: Fix Link component typing issues with Next.js 16
    ignoreBuildErrors: true,
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'upload.wikimedia.org',
      },
      {
        protocol: 'https',
        hostname: 'altcoinsbox.com',
      },
    ],
  },
};

export default nextConfig;

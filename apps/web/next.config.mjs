/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@advance-ecommerce/db", "@advance-ecommerce/validators"],
  // instrumentation.ts (server-start DB wiring for feature flags +
  // coupon snapshot) needs the hook enabled on Next 14.
  experimental: { instrumentationHook: true },
  // Keep the Prisma client external so it is required from real
  // node_modules at runtime instead of being bundled.
  serverExternalPackages: ["@prisma/client", ".prisma/client", "bullmq", "ioredis"],
  // Image optimization (speed wave batch 2): AVIF/WebP output for
  // next/image. Remote hosts: demo placeholder photos (picsum) plus the
  // object-storage hosts merchant uploads will live on later (R2 public
  // buckets, R2 S3-compatible endpoint, AWS S3).
  images: {
    formats: ["image/avif", "image/webp"],
    remotePatterns: [
      { protocol: "https", hostname: "picsum.photos" },
      { protocol: "https", hostname: "*.r2.dev" },
      { protocol: "https", hostname: "*.cloudflarestorage.com" },
      { protocol: "https", hostname: "*.amazonaws.com" },
    ],
  },
  // Static-asset cache headers (speed wave batch 2): generated PWA icons
  // are content-stable, so cache them immutably for a year; the manifest
  // changes rarely (1 day); the service worker itself must revalidate on
  // every load so updates ship promptly.
  async headers() {
    return [
      {
        source: "/icons/:path*",
        headers: [
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
        ],
      },
      {
        source: "/manifest.webmanifest",
        headers: [{ key: "Cache-Control", value: "public, max-age=86400" }],
      },
      {
        source: "/sw.js",
        headers: [{ key: "Cache-Control", value: "public, max-age=0, must-revalidate" }],
      },
    ];
  },
};
export default nextConfig;

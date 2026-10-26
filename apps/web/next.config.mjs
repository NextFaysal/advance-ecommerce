/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@advance-ecommerce/db", "@advance-ecommerce/validators"],
  // instrumentation.ts (server-start DB wiring for feature flags +
  // coupon snapshot) needs the hook enabled on Next 14.
  experimental: {
    instrumentationHook: true,
    serverComponentsExternalPackages: ["@prisma/client", ".prisma/client", "ioredis"],
  },
  webpack: (config, { isServer, nextRuntime, webpack }) => {
    config.plugins.push(
      new webpack.NormalModuleReplacementPlugin(/^node:/, (resource) => {
        resource.request = resource.request.replace(/^node:/, "");
      }),
    );

    if (nextRuntime === "edge" || !isServer) {
      config.resolve.alias = {
        ...config.resolve.alias,
        ioredis: false,
      };
      config.resolve.fallback = {
        ...config.resolve.fallback,
        net: false,
        dns: false,
        tls: false,
        fs: false,
        stream: false,
        crypto: false,
        ioredis: false,
      };
    }
    return config;
  },
};
export default nextConfig;
